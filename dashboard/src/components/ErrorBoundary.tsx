import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight:"100vh", display:"flex", flexDirection:"column",
          alignItems:"center", justifyContent:"center",
          background:"#0f172a", color:"#f8fafc", fontFamily:"monospace",
          padding:32, gap:16
        }}>
          <h1 style={{fontSize:24, color:"#f87171"}}>Runtime Error</h1>
          <pre style={{
            background:"#1e293b", padding:20, borderRadius:10,
            maxWidth:700, whiteSpace:"pre-wrap", color:"#fbbf24", fontSize:13
          }}>{this.state.error.message}</pre>
          <pre style={{
            background:"#1e293b", padding:20, borderRadius:10,
            maxWidth:700, whiteSpace:"pre-wrap", color:"#94a3b8", fontSize:11
          }}>{this.state.error.stack}</pre>
          <button onClick={() => window.location.reload()}
            style={{padding:"10px 24px", borderRadius:8, background:"#6366f1",
              color:"#fff", border:"none", cursor:"pointer", fontWeight:600, fontSize:14}}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
