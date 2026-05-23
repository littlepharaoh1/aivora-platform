/**
 * ErrorBoundary.tsx — Global Error Boundary
 * Catches uncaught React render exceptions
 */
import React from "react";

interface Props {
  children:  React.ReactNode;
  fallback?: React.ReactNode;
  label?:    string;
}

interface State {
  error:   Error | null;
  hasError:boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error, hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.label ?? "unknown"}]`, error, info);
  }

  render() {
    if(this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{
          display:"flex", flexDirection:"column", alignItems:"center",
          justifyContent:"center", height:"100%", minHeight:200,
          background:"#0a0a0a", color:"#ef4444", gap:8, padding:16,
        }}>
          <span style={{fontSize:14, fontWeight:600}}>
            ⚠ {this.props.label ?? "Component"} Error
          </span>
          <span style={{fontSize:11, color:"#6b7280", textAlign:"center", maxWidth:400}}>
            {this.state.error?.message ?? "An unexpected error occurred"}
          </span>
          <button
            onClick={() => this.setState({ error:null, hasError:false })}
            style={{
              marginTop:8, padding:"4px 12px", fontSize:11,
              background:"#1f2937", color:"#9ca3af",
              border:"1px solid #374151", borderRadius:4, cursor:"pointer",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
