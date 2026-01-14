let debugConsoleEnabled = false;

if (typeof window !== 'undefined') {
    try {
        const saved = localStorage.getItem('showDebugConsole');
        debugConsoleEnabled = saved ? JSON.parse(saved) : false;
    } catch {
        debugConsoleEnabled = false;
    }
}

export function setDebugConsoleEnabled(value: boolean): void {
    debugConsoleEnabled = !!value;
}

export function isDebugConsoleEnabled(): boolean {
    return debugConsoleEnabled;
}
