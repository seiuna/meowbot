/**
 * 数据格式化工具集
 * 提供日期、文本、消息元数据等各种格式化方法
 */


/**
 * 日期格式化工具
 */
export const DateFormatters = {
  /**
   * 将日期转换为本地时间字符串 (zh-CN)
   */
  toLocaleString(date: Date | number): string {
    const d = typeof date === 'number' ? new Date(date) : date;
    try {
      return d.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return d.toString();
    }
  },

  /**
   * 转换为 ISO 格式字符串
   */
  toISO(date: Date | number): string {
    const d = typeof date === 'number' ? new Date(date) : date;
    return d.toISOString();
  },

  /**
   * 转换为 Unix 时间戳
   */
  toUnixTimestamp(date: Date | number): number {
    return typeof date === 'number' ? date : date.getTime();
  },

  /**
   * 格式化为相对时间 (如 "2 小时前")
   */
  toRelative(date: Date | number): string {
    const now = Date.now();
    const target = typeof date === 'number' ? date : date.getTime();
    const diff = now - target;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 30) return `${days} 天前`;

    return this.toLocaleString(date);
  },

  /**
   * 仅保留日期部分的格式化
   */
  toDateOnly(date: Date | number): string {
    const d = typeof date === 'number' ? new Date(date) : date;
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  },

  /**
   * 仅保留时间部分的格式化
   */
  toTimeOnly(date: Date | number): string {
    const d = typeof date === 'number' ? new Date(date) : date;
    return d.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
};

/**
 * 文本格式化工具
 */
export const TextFormatters = {
  /**
   * 截断文本并添加后缀
   */
  truncate(text: string, maxLength: number, suffix: string = '...'): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - suffix.length) + suffix;
  },

  /**
   * 规范化空白字符 (将连续空格替换为单个空格)
   */
  normalizeWhitespace(text: string): string {
    return text.trim().replace(/\s+/g, ' ');
  },

  /**
   * 获取文本第一行
   */
  toFirstLine(text: string): string {
    return text.split('\n')[0];
  },

  /**
   * 获取文本前几行
   */
  toFirstLines(text: string, count: number): string {
    return text.split('\n').slice(0, count).join('\n');
  },

  /**
   * 移除所有空白字符
   */
  removeWhitespace(text: string): string {
    return text.replace(/\s/g, '');
  },

  /**
   * 转换为 Markdown 代码块格式
   */
  toCodeBlock(text: string, language: string = ''): string {
    return `\`\`\`${language}\n${text}\n\`\`\``;
  },

  /**
   * 转换为 Markdown 行内代码
   */
  toInlineCode(text: string): string {
    return `\`${text}\``;
  },

  /**
   * 转换为短横线链接命名法 (kebab-case)
   */
  toKebabCase(text: string): string {
    return text
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/\s+/g, '-')
      .toLowerCase();
  },

  /**
   * 转换为下划线命名法 (snake_case)
   */
  toSnakeCase(text: string): string {
    return text
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/\s+/g, '_')
      .toLowerCase();
  },

  /**
   * 转换为小驼峰命名法 (camelCase)
   */
  toCamelCase(text: string): string {
    return text
      .split(/[\s_-]+/)
      .map((word, index) =>
        index === 0
          ? word.toLowerCase()
          : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      )
      .join('');
  },

  /**
   * 转换为大驼峰命名法 (PascalCase)
   */
  toPascalCase(text: string): string {
    return text
      .split(/[\s_-]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  },

  /**
   * 首字母大写
   */
  capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  },

  /**
   * 重复字符串
   */
  repeat(text: string, count: number, separator: string = ''): string {
    return Array(count).fill(text).join(separator);
  },

  /**
   * 居中填充字符串
   */
  pad(text: string, length: number, fillChar: string = ' '): string {
    if (text.length >= length) return text;
    const padLeft = Math.floor((length - text.length) / 2);
    const padRight = length - text.length - padLeft;
    return fillChar.repeat(padLeft) + text + fillChar.repeat(padRight);
  }
};

/**
 * 消息相关格式化工具
 */
export const MessageFormatters = {
  /**
   * 格式化为列表形式
   */
  formatList<T>(items: T[], format: (item: T, index: number) => string): string {
    return items.map((item, index) => `${index + 1}. ${format(item, index)}`).join('\n');
  },

  /**
   * 格式化为表格形式
   */
  formatTable(headers: string[], rows: string[][]): string {
    const widths = headers.map((h, i) =>
      Math.max(
        h.length,
        ...rows.map(row => (row[i] || '').toString().length)
      )
    );

    const separator = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
    const headerRow =
      '| ' + headers.map((h, i) => h.padEnd(widths[i])).join(' | ') + ' |';

    const dataRows = rows.map(
      row =>
        '| ' + row.map((cell, i) => (cell || '').toString().padEnd(widths[i])).join(' | ') + ' |'
    );

    return [separator, headerRow, separator, ...dataRows, separator].join('\n');
  },

  /**
   * 格式化 JSON 数据并支持递归深度限制
   */
  formatJSON(
    obj: any,
    indent: number = 2,
    maxDepth: number = 3,
    currentDepth: number = 0
  ): string {
    if (currentDepth > maxDepth) {
      return '[...]';
    }

    if (obj === null) return 'null';
    if (typeof obj === 'string') return `"${obj}"`;
    if (typeof obj !== 'object') return String(obj);

    const prefix = ' '.repeat(indent * currentDepth);
    const innerPrefix = ' '.repeat(indent * (currentDepth + 1));

    if (Array.isArray(obj)) {
      if (obj.length === 0) return '[]';
      const items = obj.map(item =>
        innerPrefix + this.formatJSON(item, indent, maxDepth, currentDepth + 1)
      );
      return '[\n' + items.join(',\n') + '\n' + prefix + ']';
    }

    const entries = Object.entries(obj);
    if (entries.length === 0) return '{}';

    const items = entries.map(
      ([key, value]) =>
        innerPrefix +
        `"${key}": ${this.formatJSON(value, indent, maxDepth, currentDepth + 1)}`
    );
    return '{\n' + items.join(',\n') + '\n' + prefix + '}';
  },
};


export const Formatters = {
  date: DateFormatters,
  text: TextFormatters,
  message: MessageFormatters
};
