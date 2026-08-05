import type { Metadata } from "next";
import QpcrAnalysisStudio from "./QpcrAnalysisStudio";

export const metadata: Metadata = {
  title: "qPCR Analysis Studio | 实时定量 PCR 分析台",
  description: "分类型导入仪器结果与板布局，在本地完成 qPCR 相对定量、复孔 QC、Tm 与熔解分组复核。",
  openGraph: {
    title: "qPCR Analysis Studio",
    description: "qPCR 相对定量、复孔质控、Tm 与熔解分组复核工具。",
    images: ["/og-qpcr-analysis-studio-v2.png"],
  },
  twitter: { card: "summary_large_image", images: ["/og-qpcr-analysis-studio-v2.png"] },
};

export default function Home() {
  return <QpcrAnalysisStudio />;
}
