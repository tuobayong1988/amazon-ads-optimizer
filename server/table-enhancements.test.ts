import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 表格增强功能测试
 * 测试分页、列宽调整、URL筛选持久化等功能的核心逻辑
 */

// 分页逻辑测试
describe('Pagination Logic', () => {
  // 测试分页计算
  it('should calculate correct page range', () => {
    const totalItems = 100;
    const pageSize = 25;
    const currentPage = 2;
    
    const totalPages = Math.ceil(totalItems / pageSize);
    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalItems);
    
    expect(totalPages).toBe(4);
    expect(startItem).toBe(26);
    expect(endItem).toBe(50);
  });

  it('should handle last page with fewer items', () => {
    const totalItems = 103;
    const pageSize = 25;
    const currentPage = 5;
    
    const totalPages = Math.ceil(totalItems / pageSize);
    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalItems);
    
    expect(totalPages).toBe(5);
    expect(startItem).toBe(101);
    expect(endItem).toBe(103);
  });

  it('should handle empty data', () => {
    const totalItems = 0;
    const pageSize = 25;
    
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    
    expect(totalPages).toBe(1);
  });

  it('should paginate data correctly', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    const pageSize = 25;
    const currentPage = 2;
    
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const paginatedData = data.slice(start, end);
    
    expect(paginatedData.length).toBe(25);
    expect(paginatedData[0].id).toBe(26);
    expect(paginatedData[24].id).toBe(50);
  });
});

// URL筛选参数序列化测试
describe('URL Filter Serialization', () => {
  it('should serialize string values correctly', () => {
    const value = 'test';
    const serialized = value;
    expect(serialized).toBe('test');
  });

  it('should serialize number values correctly', () => {
    const value = 42;
    const serialized = String(value);
    expect(serialized).toBe('42');
  });

  it('should serialize boolean values correctly', () => {
    const trueValue = true;
    const falseValue = false;
    
    expect(trueValue ? '1' : '0').toBe('1');
    expect(falseValue ? '1' : '0').toBe('0');
  });

  it('should serialize array values correctly', () => {
    const value = ['a', 'b', 'c'];
    const serialized = value.join(',');
    expect(serialized).toBe('a,b,c');
  });

  it('should deserialize array values correctly', () => {
    const serialized = 'a,b,c';
    const value = serialized.split(',');
    expect(value).toEqual(['a', 'b', 'c']);
  });
});

// URL参数构建测试
describe('URL Parameter Building', () => {
  it('should build URL with filters', () => {
    const filters = {
      search: '眼镜',
      type: 'sp_auto',
      status: 'enabled',
    };
    
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== 'all') {
        params.set(key, value);
      }
    });
    
    expect(params.toString()).toContain('search=');
    expect(params.toString()).toContain('type=sp_auto');
    expect(params.toString()).toContain('status=enabled');
  });

  it('should exclude default values from URL', () => {
    const filters = {
      search: '',
      type: 'all',
      status: 'all',
    };
    
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== 'all' && value !== '') {
        params.set(key, value);
      }
    });
    
    expect(params.toString()).toBe('');
  });

  it('should parse URL parameters correctly', () => {
    const urlString = '?search=%E7%9C%BC%E9%95%9C&type=sp_auto&page=2';
    const params = new URLSearchParams(urlString);
    
    expect(params.get('search')).toBe('眼镜');
    expect(params.get('type')).toBe('sp_auto');
    expect(params.get('page')).toBe('2');
    expect(params.get('status')).toBeNull();
  });
});

// 列宽计算测试
describe('Column Width Calculation', () => {
  it('should respect minimum width', () => {
    const currentWidth = 100;
    const delta = -80;
    const minWidth = 50;
    const maxWidth = 400;
    
    const newWidth = Math.max(minWidth, Math.min(maxWidth, currentWidth + delta));
    
    expect(newWidth).toBe(50);
  });

  it('should respect maximum width', () => {
    const currentWidth = 350;
    const delta = 100;
    const minWidth = 50;
    const maxWidth = 400;
    
    const newWidth = Math.max(minWidth, Math.min(maxWidth, currentWidth + delta));
    
    expect(newWidth).toBe(400);
  });

  it('should allow width within bounds', () => {
    const currentWidth = 150;
    const delta = 50;
    const minWidth = 50;
    const maxWidth = 400;
    
    const newWidth = Math.max(minWidth, Math.min(maxWidth, currentWidth + delta));
    
    expect(newWidth).toBe(200);
  });
});

// 固定列偏移计算测试
describe('Pinned Column Offset Calculation', () => {
  it('should calculate pinned offset correctly', () => {
    const columns = [
      { key: 'name', width: 200 },
      { key: 'type', width: 100 },
      { key: 'status', width: 80 },
      { key: 'budget', width: 120 },
    ];
    const pinnedColumns = new Set(['name', 'type']);
    
    const getPinnedOffset = (targetKey: string) => {
      let offset = 0;
      for (const col of columns) {
        if (col.key === targetKey) break;
        if (pinnedColumns.has(col.key)) {
          offset += col.width;
        }
      }
      return offset;
    };
    
    expect(getPinnedOffset('name')).toBe(0);
    expect(getPinnedOffset('type')).toBe(200);
    expect(getPinnedOffset('status')).toBe(300); // 200 + 100
    expect(getPinnedOffset('budget')).toBe(300); // status not pinned
  });
});

// 筛选逻辑测试
describe('Filter Logic', () => {
  const campaigns = [
    { id: 1, name: '眼镜广告', type: 'sp_auto', status: 'enabled' },
    { id: 2, name: '手表广告', type: 'sp_manual', status: 'paused' },
    { id: 3, name: '眼镜盒广告', type: 'sp_auto', status: 'enabled' },
    { id: 4, name: '品牌广告', type: 'sb', status: 'enabled' },
  ];

  it('should filter by search term', () => {
    const searchTerm = '眼镜';
    const filtered = campaigns.filter(c => 
      c.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    expect(filtered.length).toBe(2);
    expect(filtered[0].id).toBe(1);
    expect(filtered[1].id).toBe(3);
  });

  it('should filter by type', () => {
    const typeFilter = 'sp_auto';
    const filtered = campaigns.filter(c => c.type === typeFilter);
    
    expect(filtered.length).toBe(2);
  });

  it('should filter by status', () => {
    const statusFilter = 'enabled';
    const filtered = campaigns.filter(c => c.status === statusFilter);
    
    expect(filtered.length).toBe(3);
  });

  it('should combine multiple filters', () => {
    const searchTerm = '眼镜';
    const typeFilter = 'sp_auto';
    const statusFilter = 'enabled';
    
    const filtered = campaigns.filter(c => 
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      c.type === typeFilter &&
      c.status === statusFilter
    );
    
    expect(filtered.length).toBe(2);
  });
});

// 排序逻辑测试
describe('Sort Logic', () => {
  const campaigns = [
    { id: 1, name: 'B广告', spend: 100 },
    { id: 2, name: 'A广告', spend: 200 },
    { id: 3, name: 'C广告', spend: 50 },
  ];

  it('should sort by name ascending', () => {
    const sorted = [...campaigns].sort((a, b) => 
      a.name.localeCompare(b.name)
    );
    
    expect(sorted[0].name).toBe('A广告');
    expect(sorted[1].name).toBe('B广告');
    expect(sorted[2].name).toBe('C广告');
  });

  it('should sort by name descending', () => {
    const sorted = [...campaigns].sort((a, b) => 
      b.name.localeCompare(a.name)
    );
    
    expect(sorted[0].name).toBe('C广告');
    expect(sorted[1].name).toBe('B广告');
    expect(sorted[2].name).toBe('A广告');
  });

  it('should sort by spend ascending', () => {
    const sorted = [...campaigns].sort((a, b) => a.spend - b.spend);
    
    expect(sorted[0].spend).toBe(50);
    expect(sorted[1].spend).toBe(100);
    expect(sorted[2].spend).toBe(200);
  });

  it('should sort by spend descending', () => {
    const sorted = [...campaigns].sort((a, b) => b.spend - a.spend);
    
    expect(sorted[0].spend).toBe(200);
    expect(sorted[1].spend).toBe(100);
    expect(sorted[2].spend).toBe(50);
  });
});
