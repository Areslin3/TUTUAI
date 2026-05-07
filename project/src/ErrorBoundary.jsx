import React from "react";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("App render error:", error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.message || String(this.state.error || "");
      return (
        <div className="app-error-boundary">
          <div className="app-error-boundary__card">
            <h1>页面暂时无法正常显示</h1>
            <p>
              通常是浏览器存储已满或遇到临时异常。你的数据多半仍在本地或云端；请先尝试刷新。若反复出现，请联系管理员并在控制台查看详细错误。
            </p>
            {msg ? <pre className="app-error-boundary__trace">{msg}</pre> : null}
            <div className="app-error-boundary__actions">
              <button type="button" className="primary-btn" onClick={() => window.location.reload()}>
                刷新页面
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                重试渲染
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
