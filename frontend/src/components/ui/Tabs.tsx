import { useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

interface Tab {
  id: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
  className?: string;
}

export function Tabs({ tabs, defaultTab, className }: TabsProps) {
  const [activeId, setActiveId] = useState(defaultTab ?? tabs[0]?.id ?? "");
  const activeTab = tabs.find((t) => t.id === activeId);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-bg-tertiary rounded-xl w-fit" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            disabled={tab.disabled}
            onClick={() => setActiveId(tab.id)}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 cursor-pointer",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              tab.id === activeId
                ? "bg-accent/15 text-accent"
                : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div role="tabpanel">{activeTab?.content}</div>
    </div>
  );
}
