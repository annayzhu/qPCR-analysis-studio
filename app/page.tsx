import type { Metadata } from "next";
import QpcrAnalysisStudio from "./QpcrAnalysisStudio";

export const metadata: Metadata = {
  title: "qPCR Analysis Studio | 实时定量 PCR 分析台",
  description: "分阶段导入仪器结果与板布局，本地自动计算并生成可筛选、可视化的 qPCR 相对定量结果。",
  openGraph: {
    title: "qPCR Analysis Studio",
    description: "从数据到可解释结果：仪器无关、本地优先、可追溯的 qPCR 分析台。",
    images: ["/og-qpcr-analysis-studio-v2.png"],
  },
  twitter: { card: "summary_large_image", images: ["/og-qpcr-analysis-studio-v2.png"] },
};

export default function Home() {
  return <QpcrAnalysisStudio />;
}
