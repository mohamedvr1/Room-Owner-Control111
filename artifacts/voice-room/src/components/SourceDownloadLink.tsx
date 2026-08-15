import { Download } from "lucide-react";

type SourceDownloadLinkProps = {
  compact?: boolean;
};

export function SourceDownloadLink({ compact = false }: SourceDownloadLinkProps) {
  const href = `${import.meta.env.BASE_URL}downloads/ghost-room-source.zip`;

  return (
    <a
      href={href}
      download="ghost-room-source.zip"
      aria-label="Download GhostRoom source ZIP"
      className={
        compact
          ? "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-mono text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
          : "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
      }
    >
      <Download className="h-3.5 w-3.5" />
      {compact ? "Source ZIP" : "Download project ZIP"}
    </a>
  );
}