/**
 * exportTable.ts 单元测试
 * 测试CSV和Excel导出的数据格式化和下载触发逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportToCSV, exportToExcel, exportTable, type ExportColumn } from './exportTable';

describe('exportTable', () => {
  const columns: ExportColumn[] = [
    { key: 'name', label: '名称' },
    { key: 'value', label: '数值' },
    { key: 'status', label: '状态' },
  ];

  const data = [
    { name: 'Campaign A', value: 100.5, status: true },
    { name: 'Campaign B', value: 200, status: false },
    { name: null, value: null, status: null },
  ];

  let mockLink: { href: string; download: string; click: ReturnType<typeof vi.fn> };
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLink = { href: '', download: '', click: vi.fn() };
    
    // Use a spy on createElement that only intercepts 'a' tags
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
      if (tag === 'a') {
        return mockLink as any;
      }
      return origCreateElement(tag, options);
    });

    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

    createObjectURLSpy = vi.fn(() => 'blob:mock-url');
    revokeObjectURLSpy = vi.fn();
    global.URL.createObjectURL = createObjectURLSpy;
    global.URL.revokeObjectURL = revokeObjectURLSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('exportToCSV', () => {
    it('should create a Blob and trigger download', () => {
      exportToCSV({ filename: 'test', columns, data });
      
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
      expect(mockLink.click).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
    });

    it('should create Blob with CSV content type', () => {
      exportToCSV({ filename: 'test', columns, data });
      
      const blobArg = createObjectURLSpy.mock.calls[0][0];
      expect(blobArg).toBeInstanceOf(Blob);
      expect(blobArg.type).toBe('text/csv;charset=utf-8;');
    });

    it('should set correct filename with .csv extension', () => {
      exportToCSV({ filename: 'my-export', columns, data });
      expect(mockLink.download).toBe('my-export.csv');
    });

    it('should handle empty data array', () => {
      expect(() => {
        exportToCSV({ filename: 'empty', columns, data: [] });
      }).not.toThrow();
      expect(mockLink.click).toHaveBeenCalled();
    });

    it('should handle empty columns array', () => {
      expect(() => {
        exportToCSV({ filename: 'no-cols', columns: [], data });
      }).not.toThrow();
    });

    it('should handle data with special characters', () => {
      const specialData = [
        { name: 'Has, comma', value: 1, status: true },
        { name: 'Has "quotes"', value: 2, status: false },
        { name: 'Has\nnewline', value: 3, status: true },
      ];
      
      expect(() => {
        exportToCSV({ filename: 'special', columns, data: specialData });
      }).not.toThrow();
    });
  });

  describe('exportToExcel', () => {
    it('should create a Blob and trigger download', () => {
      exportToExcel({ filename: 'test', columns, data });
      
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
      expect(mockLink.click).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
    });

    it('should create Blob with Excel content type', () => {
      exportToExcel({ filename: 'test', columns, data });
      
      const blobArg = createObjectURLSpy.mock.calls[0][0];
      expect(blobArg).toBeInstanceOf(Blob);
      expect(blobArg.type).toBe('application/vnd.ms-excel;charset=utf-8;');
    });

    it('should set correct filename with .xls extension', () => {
      exportToExcel({ filename: 'my-export', columns, data });
      expect(mockLink.download).toBe('my-export.xls');
    });

    it('should handle data with XML special characters', () => {
      const xmlData = [
        { name: '<script>alert("xss")</script>', value: 1, status: true },
        { name: 'A & B', value: 2, status: false },
      ];
      
      expect(() => {
        exportToExcel({ filename: 'xml-safe', columns, data: xmlData });
      }).not.toThrow();
    });
  });

  describe('exportTable', () => {
    it('should call exportToCSV when format is csv', () => {
      exportTable({ filename: 'test', columns, data, format: 'csv' });
      
      const blobArg = createObjectURLSpy.mock.calls[0][0];
      expect(blobArg.type).toBe('text/csv;charset=utf-8;');
    });

    it('should call exportToExcel when format is excel', () => {
      exportTable({ filename: 'test', columns, data, format: 'excel' });
      
      const blobArg = createObjectURLSpy.mock.calls[0][0];
      expect(blobArg.type).toBe('application/vnd.ms-excel;charset=utf-8;');
    });
  });
});
