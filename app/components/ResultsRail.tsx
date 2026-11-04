import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Settings live beside the figure; the explorers that own their state render them through this portal. */
export const ResultsRailContext = createContext<HTMLElement | null>(null);

export function ResultsRail({ children }: { children: ReactNode }) {
  const rail = useContext(ResultsRailContext);
  return rail ? createPortal(children, rail) : <>{children}</>;
}
