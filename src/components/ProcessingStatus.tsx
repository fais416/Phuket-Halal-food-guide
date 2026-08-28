"use client";

export default function ProcessingStatus({ log }: { log: string[] }) {
  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" />
        <p className="text-sm font-semibold text-white/90">Directing your product ad…</p>
      </div>
      <ul className="space-y-2">
        {log.map((message, i) => {
          const isLast = i === log.length - 1;
          return (
            <li
              key={`${message}-${i}`}
              className={`text-sm transition-opacity ${isLast ? "text-white" : "text-white/40"}`}
            >
              {message}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
