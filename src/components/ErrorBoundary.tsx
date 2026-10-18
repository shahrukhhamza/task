import { Component, type ReactNode } from 'react';
import { exportAll } from '../lib/db/actions';
import { download } from '../lib/download';

interface State {
  error: Error | null;
}

/** Last line of defence: explain, offer a reload, and always let people save their data. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Dayflow crashed:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto mt-16 max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Your data is safe on this device. Reloading usually fixes it. If it keeps happening, download a backup first.
        </p>
        <p className="mt-3 break-words rounded-lg bg-slate-100 p-2 text-left font-mono text-xs dark:bg-slate-800">{this.state.error.message}</p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-slate-300 dark:ring-slate-600"
            onClick={async () => {
              const { json } = await exportAll();
              download(`dayflow-backup-${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json');
            }}
          >
            Download my data
          </button>
          <button type="button" className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
