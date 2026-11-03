import { createContext } from 'react';
export type ChartPresentation = {
    activeTarget: string;
    overview: boolean;
    selectedTargets: string[];
    names: Record<string, string>;
    settings: Record<string, {
        showTechnicalSd: boolean;
        theme: 'paper' | 'dark';
        axisMode: 'linear' | 'log-ratio';
    }>;
};
export const emptyChartPresentation: ChartPresentation = { activeTarget: '', overview: false, selectedTargets: [], names: {}, settings: {} };
export const ChartPresentationContext = createContext<{
    config: ChartPresentation;
    update: (patch: Partial<ChartPresentation>) => void;
}>({ config: emptyChartPresentation, update: () => { } });
