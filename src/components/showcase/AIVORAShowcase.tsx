/**
 * AIVORAShowcase.tsx — Premium Showcase (Updated)
 */
import React, { useEffect, useRef } from "react";

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>AIVORA</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#060608;color:#f4f4f5;font-family:Inter,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;}
.center{text-align:center;}
h1{font-size:64px;font-weight:900;letter-spacing:-3px;-webkit-text-stroke:1px rgba(255,255,255,0.2);-webkit-text-fill-color:transparent;}
p{font-size:14px;color:rgba(255,255,255,0.4);margin-top:12px;}
</style>
</head>
<body>
<div class="center">
  <h1>AIVORA</h1>
  <p>Loading platform...</p>
</div>
</body>
</html>`;

export default function AIVORAShowcase({ onEnter }: { onEnter?: () => void }) {
  return (
    <div style={{width:"100vw",height:"100vh",background:"#060608",
      display:"flex",alignItems:"center",justifyContent:"center"}}>
      <button onClick={onEnter} style={{
        padding:"14px 32px",borderRadius:10,background:"white",
        color:"#060608",border:"none",fontSize:14,fontWeight:600,cursor:"pointer"
      }}>Enter AIVORA Platform</button>
    </div>
  );
}
