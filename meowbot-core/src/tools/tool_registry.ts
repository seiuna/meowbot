/**
 * 工具注册表实现
 * 提供统一的工具管理和过滤
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { getLogger } from '../utils/logs.js';

const logger = getLogger('ToolRegistry');
export interface IToolProvider {
  pullAllTools(): DynamicStructuredTool[]

  getName(): string;

  getDescription(): string;
}

export class ToolProvider implements IToolProvider {

  private name: string;
  private description: string;
  private tools: DynamicStructuredTool[] = [];

  constructor(name: string, description: string){
  this.name = name;
  this.description = description;
  }

  getName(): string {
    return this.name;
  }

  getDescription(): string {
    return this.description;
  }

  pullAllTools(): DynamicStructuredTool[] {
    return this.tools;
  }

  defineTool(tool: DynamicStructuredTool){
    if (!tool.name || !tool.description || !tool.schema) {
      throw new Error('Invalid tool definition');
    }
    this.tools.push(tool);
  }
}

/**
 * Simple, immutable tool provider — pass tools and metadata at construction time.
 * Eliminates the need to subclass IToolProvider for basic providers.
 */
export class SimpleToolProvider implements IToolProvider {
  constructor(
    private name: string,
    private description: string,
    private tools: DynamicStructuredTool[],
  ) {}

  pullAllTools(): DynamicStructuredTool[] { return this.tools; }
  getName(): string { return this.name; }
  getDescription(): string { return this.description; }
}

export interface IToolRegistry {
}

export class ToolRegistry implements IToolRegistry {
  private providers: Map<string, IToolProvider> = new Map();


  register(provider: IToolProvider): void {
    this.providers.set(provider.getName(), provider);
    const toolCount = provider.pullAllTools().length;
    logger.info(`Tool provider registered: ${provider.getName()} (${toolCount} tools)`);
  }


  unregister(name: string): void {
    if (this.providers.delete(name)) {
      logger.info(`Tool provider unregistered: ${name}`);
    }
  }

  /**
   * 获取所有工具
   */
  getAllTools(): DynamicStructuredTool[] {
    const tools: DynamicStructuredTool[] = [];

    for (const provider of this.providers.values()) {
      try {
        tools.push(...provider.pullAllTools());
      } catch (error) {
        logger.warn(
          `Failed to pull tools from provider ${provider.getName()}`,
          { error: error instanceof Error ? error.message : String(error) }
        );
      }
    }

    return tools;
  }

  /**
   * 获取启用的工具 (only filters by isEnabled flag)
   */
  getToolsForEnvironment(_env?: string): DynamicStructuredTool[] {
    return this.getAllTools().filter(t => this.isToolEnabled(t));
  }

  /**
   * 获取指定 provider 的启用工具
   */
  getToolsForProviders(providerNames: string[], _env?: string): DynamicStructuredTool[] {
    const tools: DynamicStructuredTool[] = [];
    for (const name of providerNames) {
      const provider = this.providers.get(name);
      if (provider) {
        try {
          tools.push(...provider.pullAllTools());
        } catch (error) {
          logger.warn(
            `Failed to pull tools from provider ${name}`,
            {error: error instanceof Error ? error.message : String(error)},
          );
        }
      } else {
        logger.debug("Tool provider \"" + name + "\" not found, skipping");
      }
    }
    return tools.filter(t => this.isToolEnabled(t));
  }

  /**
   * 获取工具提供者列表
   */
  getProviders(): IToolProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 检查工具是否启用 (默认启用，仅当 isEnabled 显式为 false 时过滤)
   */
  private isToolEnabled(tool: DynamicStructuredTool): boolean {
    return (tool as any).isEnabled !== false;
  }

  /**
   * 验证工具
   */
  validateTool(tool: DynamicStructuredTool): boolean {
    try {
      return (
        'name' in tool &&
        'description' in tool &&
        'schema' in tool &&
        typeof tool.name === 'string' &&
        typeof tool.description === 'string'
      );
    } catch {
      return false;
    }
  }

  /**
   * 搜索工具
   */
  searchTools(query: string, _env?: string): DynamicStructuredTool[] {
    const allTools = this.getAllTools();
    const queryLower = query.toLowerCase();

    return allTools.filter(tool => {
      const name = (tool.name || '').toLowerCase();
      const description = (tool.description || '').toLowerCase();
      return name.includes(queryLower) || description.includes(queryLower);
    });
  }

  /**
   * 获取工具详情
   */
  getToolInfo(toolName: string): any {
    const allTools = this.getAllTools();
    const tool = allTools.find(t => t.name === toolName);

    if (!tool) {
      return null;
    }

    const envTool = tool as any;
    return {
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
      perms: envTool.perms ?? [],
      isEnabled: envTool.isEnabled ?? true,
      required: envTool.required ?? false,
    };
  }

  /**
   * 获取工具统计
   */
  getStats(): {
    totalProviders: number;
    totalTools: number;
    toolsByProvider: Record<string, number>;
  } {
    const stats = {
      totalProviders: this.providers.size,
      totalTools: 0,
      toolsByProvider: {} as Record<string, number>
    };

    for (const [name, provider] of this.providers) {
      try {
        const tools = provider.pullAllTools();
        stats.toolsByProvider[name] = tools.length;
        stats.totalTools += tools.length;
      } catch {
        stats.toolsByProvider[name] = 0;
      }
    }

    return stats;
  }

  /**
   * 打印调试信息
   */
  printDebugInfo(): void {
    const stats = this.getStats();

    console.log('\n=== Tool Registry Debug Info ===');
    console.log(`Total Providers: ${stats.totalProviders}`);
    console.log(`Total Tools: ${stats.totalTools}`);
    console.log('Tools by Provider:');
    for (const [name, count] of Object.entries(stats.toolsByProvider)) {
      console.log(`  - ${name}: ${count}`);
    }
    console.log('================================\n');
  }
}


export const toolRegistry = new ToolRegistry();



