/**
 * 表格数据导出工具
 * 支持CSV和Excel格式导出
 */

export interface ExportColumn {
  key: string;
  label: string;
}

export interface ExportOptions {
  filename: string;
  columns: ExportColumn[];
  data: Record<string, any>[];
  format: 'csv' | 'excel';
}

/**
 * 格式化单元格值用于导出
 */
function formatCellValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  // 处理包含逗号、换行或引号的字符串
  const str = String(value);
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * 导出为CSV格式
 */
export function exportToCSV(options: Omit<ExportOptions, 'format'>): void {
  const { filename, columns, data } = options;
  
  // 构建CSV内容
  const headers = columns.map(col => formatCellValue(col.label)).join(',');
  const rows = data.map(row => 
    columns.map(col => formatCellValue(row[col.key])).join(',')
  );
  
  // 添加BOM以支持中文
  const BOM = '\uFEFF';
  const csvContent = BOM + [headers, ...rows].join('\n');
  
  // 创建下载链接
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 导出为Excel格式（使用简单的XML格式）
 */
export function exportToExcel(options: Omit<ExportOptions, 'format'>): void {
  const { filename, columns, data } = options;
  
  // 构建Excel XML内容
  const escapeXml = (str: string) => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };
  
  const headerCells = columns.map(col => 
    `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(col.label)}</Data></Cell>`
  ).join('');
  
  const dataRows = data.map(row => {
    const cells = columns.map(col => {
      const value = row[col.key];
      const type = typeof value === 'number' ? 'Number' : 'String';
      const displayValue = value === null || value === undefined ? '' : String(value);
      return `<Cell><Data ss:Type="${type}">${escapeXml(displayValue)}</Data></Cell>`;
    }).join('');
    return `<Row>${cells}</Row>`;
  }).join('\n');
  
  const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#CCCCCC" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="数据">
    <Table>
      <Row>${headerCells}</Row>
      ${dataRows}
    </Table>
  </Worksheet>
</Workbook>`;
  
  // 创建下载链接
  const blob = new Blob([xmlContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 统一导出函数
 */
export function exportTable(options: ExportOptions): void {
  if (options.format === 'csv') {
    exportToCSV(options);
  } else {
    exportToExcel(options);
  }
}
