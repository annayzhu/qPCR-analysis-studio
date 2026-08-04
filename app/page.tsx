import type { Metadata } from "next";
import QpcrAnalysisStudio from "./QpcrAnalysisStudio";

export const metadata: Metadata = {
  title: "qPCR Analysis Studio | 实时定量 PCR 分析台",
  description: "仪器无关、本地优先、可追溯的 qPCR 相对定量分析工具。",
  openGraph: {
    title: "qPCR Analysis Studio",
    description: "从原始孔位到可追溯结果的仪器无关 qPCR 分析台。",
    images: ["/og-qpcr-analysis-studio.png"],
  },
  twitter: { card: "summary_large_image", images: ["/og-qpcr-analysis-studio.png"] },
};

export default function Home() {
  return <QpcrAnalysisStudio />;
}
