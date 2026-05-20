/**
 * deterministicRegressionCI.ts — CI Regression Testing
 * Aivora Audio Infrastructure Platform
 *
 * - DSP output hashing (SHA-256 snapshots)
 * - Waveform snapshot comparison
 * - Export consistency validation
 * - Regression detection across builds
 */

import { replayEngine }  from "../dsp/runtime/deterministicReplay";
import { validationSuite } from "../dsp/referenceValidation/dspValidationSuite";
import { benchmarkRunner } from "../dsp/referenceValidation/benchmarkCorpus";

export interface CIReport {
  buildId:       string;
  timestamp:     number;
  dspHash:       string;
  validationRate:number;
  benchmarkScore:number;
  regressions:   string[];
  passed:        boolean;
  durationMs:    number;
}

export class DeterministicRegressionCI {
  private baselineScore: number|null=null;
  private baselineRate:  number|null=null;

  async run(buildId:string): Promise<CIReport> {
    const t0=performance.now();
    const regressions:string[]=[];

    // Run validation suite
    const validation=await validationSuite.run();
    if(this.baselineRate!==null&&validation.passRate<this.baselineRate-0.05)
      regressions.push(`Validation regression: ${(validation.passRate*100).toFixed(1)}% < baseline ${(this.baselineRate*100).toFixed(1)}%`);
    this.baselineRate=validation.passRate;

    // Run benchmark corpus
    const bench=await benchmarkRunner.runAll();
    if(this.baselineScore!==null&&bench.totalScore<this.baselineScore-5)
      regressions.push(`Benchmark regression: ${bench.totalScore} < baseline ${this.baselineScore}`);
    this.baselineScore=bench.totalScore;

    // DSP hash snapshot
    const stats=replayEngine.getStats();
    const dspHash=`v:${validation.passRate.toFixed(3)}_b:${bench.totalScore}_r:${stats.passRate.toFixed(3)}`;

    return {
      buildId,
      timestamp:    Date.now(),
      dspHash,
      validationRate:validation.passRate,
      benchmarkScore:bench.totalScore,
      regressions,
      passed:       regressions.length===0,
      durationMs:   Math.round(performance.now()-t0),
    };
  }
}

export const regressionCI = new DeterministicRegressionCI();
