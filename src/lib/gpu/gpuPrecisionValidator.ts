/**
 * gpuPrecisionValidator.ts — GPU vs CPU Precision Validator
 * Aivora Audio Infrastructure Platform
 *
 * Phase gate: φ deviation > 0.01 rad → rollback to repairAgent
 * Cross-correlation matrix tracking real-time phase shift
 */

import { repairAgent } from "../agents/repairAgent";

export const PHASE_THRESHOLD_RAD = 0.01;
export const SNR_MIN_DB          = 60.0;

export type ValidationStatus = "pass" | "fail_phase" | "fail_snr" | "fail_nan" | "rollback";

export interface PrecisionReport {
  operation:     string;
  status:        ValidationStatus;
  maxPhaseRad:   number;
  meanPhaseRad:  number;
  snrDb:         number;
  maxAbsError:   number;
  rmsError:      number;
  rollbackFired: boolean;
  durationMs:    number;
  timestamp:     number;
}

export interface ValidationStats {
  total: number; passed: number; failed: number;
  rollbacks: number; meanPhaseRad: number; meanSnrDb: number;
}

function fft(re: Float64Array, im: Float64Array): void {
  const n=re.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
    if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}
  }
  for(let len=2;len<=n;len<<=1){
    const ang=-2*Math.PI/len,wR=Math.cos(ang),wI=Math.sin(ang);
    for(let i=0;i<n;i+=len){
      let cR=1,cI=0;
      for(let j=0;j<len>>1;j++){
        const uR=re[i+j],uI=im[i+j];
        const vR=re[i+j+len/2]*cR-im[i+j+len/2]*cI;
        const vI=re[i+j+len/2]*cI+im[i+j+len/2]*cR;
        re[i+j]=uR+vR;im[i+j]=uI+vI;
        re[i+j+len/2]=uR-vR;im[i+j+len/2]=uI-vI;
        const nR=cR*wR-cI*wI;cI=cR*wI+cI*wR;cR=nR;
      }
    }
  }
}

function computePhaseDeviation(cpu: Float32Array, gpu: Float32Array): { maxPhase:number; meanPhase:number } {
  const N=Math.min(cpu.length,gpu.length);
  const fftN=Math.min(512,N);
  const cRe=new Float64Array(fftN), cIm=new Float64Array(fftN);
  const gRe=new Float64Array(fftN), gIm=new Float64Array(fftN);

  for(let i=0;i<fftN;i++){
    const w=0.5*(1-Math.cos(2*Math.PI*i/(fftN-1)));
    cRe[i]=(i<N?cpu[i]:0)*w;
    gRe[i]=(i<N?gpu[i]:0)*w;
  }
  fft(cRe,cIm); fft(gRe,gIm);

  let maxPhi=0, sumPhi=0, count=0;
  for(let k=1;k<fftN/2;k++){
    const cMag=Math.sqrt(cRe[k]**2+cIm[k]**2);
    const gMag=Math.sqrt(gRe[k]**2+gIm[k]**2);
    if(cMag<1e-6||gMag<1e-6) continue;

    // Cross-spectrum: GPU * conj(CPU)
    const xRe= gRe[k]*cRe[k]+gIm[k]*cIm[k];
    const xIm= gIm[k]*cRe[k]-gRe[k]*cIm[k];
    const phi=Math.abs(Math.atan2(xIm,xRe));

    if(phi>maxPhi) maxPhi=phi;
    sumPhi+=phi; count++;
  }
  return { maxPhase:maxPhi, meanPhase:count>0?sumPhi/count:0 };
}

function computeSNR(ref: Float32Array, act: Float32Array): number {
  const n=Math.min(ref.length,act.length);
  let sE=0,nE=0;
  for(let i=0;i<n;i++){ sE+=ref[i]**2; nE+=(act[i]-ref[i])**2; }
  return nE>1e-15?10*Math.log10(sE/nE):120;
}

function hasNaNInf(d: Float32Array): boolean {
  for(let i=0;i<d.length;i+=8) if(!isFinite(d[i])) return true;
  return false;
}

export class GPUPrecisionValidator {
  private readonly history: PrecisionReport[] = [];
  private rollbacks = 0;

  async validate(
    operation: string,
    cpuOutput: Float32Array,
    gpuOutput: Float32Array,
    sr = 48000
  ): Promise<PrecisionReport> {
    const t0=performance.now();

    if(hasNaNInf(gpuOutput))
      return this._rollback(operation,"fail_nan",0,0,0,0,0,t0,sr,cpuOutput);

    const { maxPhase,meanPhase }=computePhaseDeviation(cpuOutput,gpuOutput);
    const snrDb=computeSNR(cpuOutput,gpuOutput);

    const n=Math.min(cpuOutput.length,gpuOutput.length);
    let maxErr=0,rmsAcc=0;
    for(let i=0;i<n;i++){
      const e=Math.abs(gpuOutput[i]-cpuOutput[i]);
      if(e>maxErr) maxErr=e; rmsAcc+=e*e;
    }
    const rmsErr=Math.sqrt(rmsAcc/n);

    if(maxPhase>PHASE_THRESHOLD_RAD)
      return this._rollback(operation,"fail_phase",maxPhase,meanPhase,snrDb,maxErr,rmsErr,t0,sr,cpuOutput);
    if(snrDb<SNR_MIN_DB)
      return this._rollback(operation,"fail_snr",maxPhase,meanPhase,snrDb,maxErr,rmsErr,t0,sr,cpuOutput);

    return this._record({
      operation, status:"pass",
      maxPhaseRad:Math.round(maxPhase*1e6)/1e6,
      meanPhaseRad:Math.round(meanPhase*1e6)/1e6,
      snrDb:Math.round(snrDb*100)/100,
      maxAbsError:Math.round(maxErr*1e6)/1e6,
      rmsError:Math.round(rmsErr*1e6)/1e6,
      rollbackFired:false,
      durationMs:Math.round((performance.now()-t0)*100)/100,
      timestamp:Date.now(),
    });
  }

  private async _rollback(
    op:string, status:ValidationStatus,
    maxPhi:number, meanPhi:number, snr:number,
    maxErr:number, rmsErr:number, t0:number,
    sr:number, fallback:Float32Array
  ): Promise<PrecisionReport> {
    this.rollbacks++;
    repairAgent.repair(fallback,sr).catch(()=>{});
    return this._record({
      operation:op, status,
      maxPhaseRad:Math.round(maxPhi*1e6)/1e6,
      meanPhaseRad:Math.round(meanPhi*1e6)/1e6,
      snrDb:Math.round(snr*100)/100,
      maxAbsError:Math.round(maxErr*1e6)/1e6,
      rmsError:Math.round(rmsErr*1e6)/1e6,
      rollbackFired:true,
      durationMs:Math.round((performance.now()-t0)*100)/100,
      timestamp:Date.now(),
    });
  }

  private _record(r: PrecisionReport): PrecisionReport {
    this.history.push(r);
    if(this.history.length>256) this.history.shift();
    return r;
  }

  getStats(): ValidationStats {
    const passed=this.history.filter(r=>r.status==="pass").length;
    const mPhi=this.history.length>0?this.history.reduce((s,r)=>s+r.meanPhaseRad,0)/this.history.length:0;
    const mSnr=this.history.length>0?this.history.reduce((s,r)=>s+r.snrDb,0)/this.history.length:0;
    return {
      total:this.history.length, passed,
      failed:this.history.length-passed, rollbacks:this.rollbacks,
      meanPhaseRad:Math.round(mPhi*1e6)/1e6,
      meanSnrDb:Math.round(mSnr*100)/100,
    };
  }

  getHistory(n=20): PrecisionReport[] { return this.history.slice(-n); }
}

export const gpuPrecisionValidator = new GPUPrecisionValidator();
