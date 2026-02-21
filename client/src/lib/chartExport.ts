/**
 * 图表导出工具函数
 * 支持导出图表为PNG/SVG格式
 */
import html2canvas from 'html2canvas';
import { safeToISODateString } from './safeDate';

export interface ExportOptions {
  filename?: string;
  format?: 'png' | 'svg';
  quality?: number; // 0-1, PNG质量
  scale?: number; // 缩放比例
  backgroundColor?: string;
  width?: number;
  height?: number;
}

/**
 * 导出图表为PNG
 */
export async function exportChartAsPNG(
  element: HTMLElement,
  options: ExportOptions = {}
): Promise<void> {
  const {
    filename = `chart_${safeToISODateString(new Date())}.png`,
    quality = 1,
    scale = 2,
    backgroundColor = '#ffffff',
    width,
    height
  } = options;

  try {
    // 使用html2canvas截图
    const canvas = await html2canvas(element, {
      scale,
      backgroundColor,
      useCORS: true,
      logging: false,
      width,
      height
    });

    // 转换为blob并下载
    canvas.toBlob((blob) => {
      if (!blob) {
        throw new Error('Failed to create blob');
      }
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    }, 'image/png', quality);

  } catch (error) {
    console.error('Export PNG failed:', error);
    throw error;
  }
}

/**
 * 导出图表为SVG
 * 注意:仅支持SVG元素
 */
export async function exportChartAsSVG(
  element: HTMLElement,
  options: ExportOptions = {}
): Promise<void> {
  const {
    filename = `chart_${safeToISODateString(new Date())}.svg`,
    width,
    height
  } = options;

  try {
    // 查找SVG元素
    const svgElement = element.querySelector('svg');
    if (!svgElement) {
      throw new Error('No SVG element found');
    }

    // 克隆SVG
    const clonedSvg = svgElement.cloneNode(true) as SVGElement;
    
    // 设置尺寸
    if (width) clonedSvg.setAttribute('width', width.toString());
    if (height) clonedSvg.setAttribute('height', height.toString());

    // 添加XML声明和样式
    const svgData = new XMLSerializer().serializeToString(clonedSvg);
    const svgBlob = new Blob(
      [`<?xml version="1.0" encoding="UTF-8"?>\n${svgData}`],
      { type: 'image/svg+xml;charset=utf-8' }
    );

    // 下载
    const link = document.createElement('a');
    link.href = URL.createObjectURL(svgBlob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);

  } catch (error) {
    console.error('Export SVG failed:', error);
    throw error;
  }
}

/**
 * 批量导出多个图表
 */
export async function exportMultipleCharts(
  elements: HTMLElement[],
  options: ExportOptions = {}
): Promise<void> {
  const {
    format = 'png',
    filename = 'charts'
  } = options;

  try {
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const indexedFilename = `${filename}_${i + 1}.${format}`;
      
      if (format === 'png') {
        await exportChartAsPNG(element, { ...options, filename: indexedFilename });
      } else {
        await exportChartAsSVG(element, { ...options, filename: indexedFilename });
      }
      
      // 添加延迟避免浏览器阻塞
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (error) {
    console.error('Batch export failed:', error);
    throw error;
  }
}

/**
 * 导出图表为Base64字符串
 * 用于嵌入到其他文档中
 */
export async function exportChartAsBase64(
  element: HTMLElement,
  options: ExportOptions = {}
): Promise<string> {
  const {
    format = 'png',
    quality = 1,
    scale = 2,
    backgroundColor = '#ffffff'
  } = options;

  try {
    if (format === 'png') {
      const canvas = await html2canvas(element, {
        scale,
        backgroundColor,
        useCORS: true,
        logging: false
      });
      
      return canvas.toDataURL('image/png', quality);
    } else {
      const svgElement = element.querySelector('svg');
      if (!svgElement) {
        throw new Error('No SVG element found');
      }
      
      const svgData = new XMLSerializer().serializeToString(svgElement);
      const base64 = btoa(unescape(encodeURIComponent(svgData)));
      return `data:image/svg+xml;base64,${base64}`;
    }
  } catch (error) {
    console.error('Export Base64 failed:', error);
    throw error;
  }
}

/**
 * 添加水印到图表
 */
export async function exportChartWithWatermark(
  element: HTMLElement,
  watermarkText: string,
  options: ExportOptions = {}
): Promise<void> {
  const {
    filename = `chart_${safeToISODateString(new Date())}.png`,
    quality = 1,
    scale = 2,
    backgroundColor = '#ffffff'
  } = options;

  try {
    // 截图
    const canvas = await html2canvas(element, {
      scale,
      backgroundColor,
      useCORS: true,
      logging: false
    });

    // 添加水印
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = '20px Arial';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.textAlign = 'right';
      ctx.fillText(watermarkText, canvas.width - 20, canvas.height - 20);
    }

    // 下载
    canvas.toBlob((blob) => {
      if (!blob) {
        throw new Error('Failed to create blob');
      }
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    }, 'image/png', quality);

  } catch (error) {
    console.error('Export with watermark failed:', error);
    throw error;
  }
}
