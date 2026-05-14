// @ts-nocheck
/**
 * DspValidationDashboard.tsx — DSP Accuracy Validation Dashboard
 * Aivora Platform — Phase 2
 */
import React, { useState } from "react";
import {
  REFERENCE_TEST_CASES,
  validateMetrics,
  generateValidationReport,
  type ValidationReport,
  type ReferenceMetrics,
} from "../lib/dsp/referenceValidation/referenceValidator";
import { analyzeAudioQuality } from "../lib/audioQc/audioAnalyzerCore";

export default function DspValidationDashboard() {
  const [report,   setReport]   = useState<ValidationReport | null>(null);
  const [running,  setRunning]  = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTest, setCurrentTest] = useState("");

  async function runValidation(files: FileList) {
    setRunning(true);
    setProgress(0);
    setReport(null);

    const results = [];
    const fileArr = Array.from(files);

    for (let i = 0; i < fileArr.length && i < REFERENCE_TEST_CASES.length; i++) {
      const testCase = REFERENCE_TEST_CASES[i];
      const file     = fileArr[i];
      setCurrentTest(testCase.name);
      setProgress(Math.round((i / fileArr.length) * 100));

      try {
        const ab  = await file.arrayBuffer();
        const ctx = new AudioContext();
        const buf = await ctx.decodeAudioData(ab);
        const mono = buf.getChannelData(0);
        const qc   = await analyzeAudioQuality(mono, buf.sampleRate, "wakeword");

        const actual: ReferenceMetrics = {
          lufs:         qc.metrics.lufs,
          snrDb:        qc.metrics.snrDb,
          truePeak:     qc.metrics.truePeak,
          speechRatio:  qc.metrics.speechRatio,
          noiseFloorDb: qc.metrics.noiseFloor,
        };

        results.push(validateMetrics(testCase, actual));
      } catch(e) {
        results.push({
          testId:   testCase.id,
          testName: testCase.name,
          passed:   false,
          checks:   [],
          score:    0,
          duration: 0,
        });
      }
    }

    setReport(generateValidationReport(results));
    setRunning(false);
    setProgress(100);
  }

  const inputRef = React.useRef(null);

  return (
    <div style={{background:"#040c14",minHeight:"100%",fontFamily:"monospace",color:"#a0c4cc",padding:16}}>

      {/* Header */}
      <div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:12,
        padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",
        justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:12,fontWeight:700,color:"#22d3ee",letterSpacing:1}}>
            🔬 DSP VALIDATION SUITE
          </div>
          <div style={{fontSize:9,color:"#4a8a9a"}}>
            Reference accuracy testing — {REFERENCE_TEST_CASES.length} test cases
          </div>
        </div>
        <button onClick={()=>inputRef.current?.click()}
          disabled={running}
          style={{background:"#22d3ee22",border:"1px solid #22d3ee44",borderRadius:8,
            padding:"6px 16px",cursor:"pointer",color:"#22d3ee",fontSize:10,fontWeight:700}}>
          {running ? `Testing... ${progress}%` : "Upload Reference WAVs"}
        </button>
        <input ref={inputRef} type="file" multiple accept=".wav"
          style={{display:"none"}}
          onChange={e=>e.target.files&&runValidation(e.target.files)}/>
      </div>

      {/* Test Cases List */}
      <div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:12,
        padding:12,marginBottom:16}}>
        <div style={{fontSize:9,color:"#4a8a9a",marginBottom:8,letterSpacing:1}}>
          REFERENCE TEST CASES
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {REFERENCE_TEST_CASES.map((tc,i)=>{
            const result = report?.results.find(r=>r.testId===tc.id);
            const color  = !result ? "#4a8a9a" : result.passed ? "#10b981" : "#ef4444";
            return (
              <div key={tc.id} style={{fontSize:8,padding:"3px 8px",borderRadius:4,
                background:color+"22",border:"1px solid "+color+"44",color}}>
                {i+1}. {tc.name}
                {result && <span style={{marginLeft:4}}>{result.passed?"✓":"✗"}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Running indicator */}
      {running && (
        <div style={{background:"#060e16",border:"1px solid #22d3ee33",borderRadius:10,
          padding:12,marginBottom:16,textAlign:"center"}}>
          <div style={{fontSize:10,color:"#22d3ee",marginBottom:8}}>
            Testing: {currentTest}
          </div>
          <div style={{height:4,background:"#0f2a3a",borderRadius:2}}>
            <div style={{height:"100%",background:"#22d3ee",borderRadius:2,
              width:progress+"%",transition:"width 0.3s"}}/>
          </div>
        </div>
      )}

      {/* Report */}
      {report && (
        <>
          {/* Summary */}
          <div style={{background:"#060e16",border:"1px solid "+
            (report.failed===0?"#10b98133":"#ef444433"),
            borderRadius:12,padding:12,marginBottom:16}}>
            <div style={{fontSize:11,color:report.failed===0?"#10b981":"#ef4444",
              fontWeight:700,marginBottom:8}}>{report.summary}</div>
            <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
              {[
                ["Total",  report.totalTests, "#22d3ee"],
                ["Passed", report.passed,     "#10b981"],
                ["Failed", report.failed,     "#ef4444"],
                ["Score",  report.score+"%",  "#f59e0b"],
              ].map(([label,value,color])=>(
                <div key={label} style={{textAlign:"center"}}>
                  <div style={{fontSize:18,fontWeight:700,color:color as string}}>{value}</div>
                  <div style={{fontSize:8,color:"#4a8a9a"}}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Drift Alerts */}
          {report.driftAlerts.length > 0 && (
            <div style={{background:"#060e16",border:"1px solid #f59e0b33",
              borderRadius:12,padding:12,marginBottom:16}}>
              <div style={{fontSize:9,color:"#f59e0b",fontWeight:700,marginBottom:8}}>
                ⚠ DSP DRIFT ALERTS
              </div>
              {report.driftAlerts.map((alert,i)=>(
                <div key={i} style={{display:"flex",gap:8,marginBottom:4,
                  fontSize:9,alignItems:"center"}}>
                  <span style={{color:alert.severity==="critical"?"#ef4444":"#f59e0b",
                    fontWeight:700,minWidth:60}}>{alert.severity.toUpperCase()}</span>
                  <span style={{color:"#22d3ee"}}>{alert.metric}</span>
                  <span style={{color:"#4a8a9a"}}>expected {alert.expected.toFixed(1)}</span>
                  <span style={{color:"#a0c4cc"}}>got {alert.actual.toFixed(1)}</span>
                  <span style={{color:"#ef4444"}}>Δ {alert.drift.toFixed(1)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Results Table */}
          <div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"8px 12px",borderBottom:"1px solid #0f2a3a",background:"#050d14"}}>
              <span style={{fontSize:9,color:"#4a8a9a",letterSpacing:1}}>DETAILED RESULTS</span>
            </div>
            {report.results.map(result=>(
              <div key={result.testId} style={{borderBottom:"1px solid #0a1a24",padding:"8px 12px"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <span style={{fontSize:10,color:result.passed?"#10b981":"#ef4444",fontWeight:700}}>
                    {result.passed?"✓":"✗"}
                  </span>
                  <span style={{fontSize:10,color:"#e0f2f8",fontWeight:700}}>{result.testName}</span>
                  <span style={{fontSize:8,color:"#4a8a9a",marginLeft:"auto"}}>
                    Score: {result.score}% | {result.duration}ms
                  </span>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {result.checks.map((check,i)=>(
                    <div key={i} style={{fontSize:7,padding:"2px 6px",borderRadius:3,
                      background:check.passed?"#10b98122":"#ef444422",
                      border:"1px solid "+(check.passed?"#10b98144":"#ef444444"),
                      color:check.passed?"#10b981":"#ef4444"}}>
                      {check.metric}: {check.actual}
                      {!check.passed && ` (exp ${check.expected}±${check.tolerance})`}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* No report yet */}
      {!report && !running && (
        <div style={{textAlign:"center",padding:40,opacity:0.4}}>
          <div style={{fontSize:32,marginBottom:8}}>🔬</div>
          <div style={{fontSize:11,color:"#4a8a9a"}}>
            Upload reference WAV files to run DSP accuracy validation
          </div>
          <div style={{fontSize:9,color:"#2a5a6a",marginTop:4}}>
            {REFERENCE_TEST_CASES.length} test cases available
          </div>
        </div>
      )}
    </div>
  );
}
