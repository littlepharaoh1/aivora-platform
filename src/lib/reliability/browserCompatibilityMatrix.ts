/**
 * browserCompatibilityMatrix.ts — Browser Compatibility Detection
 * Aivora Audio Infrastructure Platform
 */

export interface BrowserCapabilities {
  browser:          string;
  version:          string;
  webgpu:           boolean;
  webgl2:           boolean;
  audioWorklet:     boolean;
  sharedArrayBuffer:boolean;
  offscreenCanvas:  boolean;
  indexedDB:        boolean;
  subtleCrypto:     boolean;
  onnxWasm:         boolean;
  performanceMemory:boolean;
  hardwareConcurrency:number;
  estimatedRAMMB:   number;
  score:            number;   // 0-100 platform capability score
}

export async function detectBrowserCapabilities(): Promise<BrowserCapabilities> {
  const ua=navigator.userAgent;
  let browser="unknown", version="0";

  if(ua.includes("Chrome"))      { browser="Chrome";  version=ua.match(/Chrome\/(\d+)/)?.[1]??"0"; }
  else if(ua.includes("Firefox")){ browser="Firefox"; version=ua.match(/Firefox\/(\d+)/)?.[1]??"0"; }
  else if(ua.includes("Safari")) { browser="Safari";  version=ua.match(/Version\/(\d+)/)?.[1]??"0"; }
  else if(ua.includes("Edge"))   { browser="Edge";    version=ua.match(/Edg\/(\d+)/)?.[1]??"0"; }

  const webgpu    = "gpu" in navigator;
  const webgl2    = !!document.createElement("canvas").getContext("webgl2");
  const audioWL   = "AudioWorklet" in window||"audioWorklet" in AudioContext.prototype;
  const sab       = typeof SharedArrayBuffer!=="undefined";
  const oc        = "OffscreenCanvas" in window;
  const idb       = "indexedDB" in window;
  const crypto_   = !!(window.crypto?.subtle);
  const perfMem   = !!(performance as unknown as{memory?:unknown}).memory;

  const cores     = navigator.hardwareConcurrency??2;
  const ramHint   = (navigator as unknown as{deviceMemory?:number}).deviceMemory??4;
  const ramMB     = ramHint*1024;

  let score=0;
  if(webgpu)    score+=30;
  else if(webgl2)score+=15;
  if(audioWL)   score+=20;
  if(sab)       score+=15;
  if(oc)        score+=10;
  if(crypto_)   score+=10;
  score+=Math.min(15,cores*2);

  return {
    browser, version, webgpu, webgl2,
    audioWorklet:audioWL, sharedArrayBuffer:sab,
    offscreenCanvas:oc, indexedDB:idb, subtleCrypto:crypto_,
    onnxWasm:true, performanceMemory:perfMem,
    hardwareConcurrency:cores, estimatedRAMMB:ramMB, score,
  };
}

export async function getCompatibilityReport(): Promise<string> {
  const caps=await detectBrowserCapabilities();
  const lines=[
    `# Aivora Browser Compatibility Report`,
    `**Browser:** ${caps.browser} ${caps.version}`,
    `**Platform Score:** ${caps.score}/100`,
    "",
    `| Feature | Status |`,
    `|---------|--------|`,
    `| WebGPU | ${caps.webgpu?"✅":"❌"} |`,
    `| WebGL2 | ${caps.webgl2?"✅":"❌"} |`,
    `| AudioWorklet | ${caps.audioWorklet?"✅":"❌"} |`,
    `| SharedArrayBuffer | ${caps.sharedArrayBuffer?"✅":"❌"} |`,
    `| OffscreenCanvas | ${caps.offscreenCanvas?"✅":"❌"} |`,
    `| SubtleCrypto | ${caps.subtleCrypto?"✅":"❌"} |`,
    `| CPU Cores | ${caps.hardwareConcurrency} |`,
    `| Est. RAM | ${caps.estimatedRAMMB}MB |`,
  ];
  return lines.join("\n");
}
