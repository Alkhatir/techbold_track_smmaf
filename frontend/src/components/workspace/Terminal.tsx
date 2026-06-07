import { useEffect, useRef } from "react";

export function Terminal({ lines, host }: { lines: string[]; host: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <div className="flex h-full flex-col bg-terminal-bg">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-mono text-[11px] text-muted-foreground">
          deploy@{host}:~$
        </span>
        <span className="font-mono text-[10px] text-success">● live</span>
      </div>
      <div
        ref={ref}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[12.5px] leading-relaxed text-foreground/90"
      >
        {lines.length === 0 ? (
          <div className="text-muted-foreground">
            No commands executed yet. Approve an action to stream output here.
          </div>
        ) : (
          lines.map((l, i) => {
            const isOk = l.includes("[ok]");
            const isErr = l.startsWith("error") || l.includes("Permission denied") || l.includes("unexpected");
            const isPrompt = l.startsWith("$ ");
            return (
              <div
                key={i}
                className={
                  isOk
                    ? "text-success"
                    : isErr
                      ? "text-danger"
                      : isPrompt
                        ? "text-info"
                        : ""
                }
              >
                {l}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}