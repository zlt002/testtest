import { cn } from '@/entrypoints/sidepanel/lib/utils';

type UnifiedEmptyStateProps = {
  title: string;
  description: string;
  className?: string;
  contentClassName?: string;
  minHeightClassName?: string;
};

export function UnifiedEmptyState({
  title,
  description,
  className,
  contentClassName,
  minHeightClassName = 'min-h-[320px]',
}: UnifiedEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-center px-6 pb-10 pt-16',
        minHeightClassName,
        className
      )}
    >
      <div className={cn('flex max-w-[320px] flex-col items-center text-center', contentClassName)}>
        <img
          src="/icon/claude-ai-icon.svg"
          alt=""
          aria-hidden="true"
          className="h-14 w-14 opacity-50 grayscale saturate-0"
        />
        <div className="mt-4 text-sm font-semibold text-foreground">{title}</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}
