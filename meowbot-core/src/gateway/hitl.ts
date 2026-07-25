/**
 * HITL (Human-In-The-Loop) 类型定义
 * 支持选择题、确认题、文本输入，以及预设选择 + 自定义输入
 */

// ── Request Types ──

/** 选项匹配结果 */
export interface MatchResult {
    matched: boolean;
    value?: string;
    error?: string;
}

/** 选项定义 */
export interface SelectOption {
    label: string;
    value: string;
    description?: string;
    /** 自定义匹配函数，返回 MatchResult */
    match?: (input: string) => MatchResult;
}

/** 选择题请求（支持自定义输入） */
export interface SelectRequest {
    type: "select";
    prompt: string;
    options: SelectOption[];
    /** 是否允许自定义输入（"其他"选项） */
    allowCustom?: boolean;
    /** "其他"选项的提示文本 */
    customLabel?: string;
    /** 自定义输入的占位符 */
    customPlaceholder?: string;
    /** 是否允许多选 */
    multiple?: boolean;
    /** 多选时最少选择数量 */
    minSelect?: number;
    /** 多选时最多选择数量 */
    maxSelect?: number;
    /** 超时时间（毫秒） */
    timeoutMs?: number;
    /** 当用户输入无效时回调（rawInput=用户原始输入, error=解析错误信息） */
    onError?: (rawInput: string, error: string) => void;
}

/** 确认题请求 */
export interface ConfirmRequest {
    type: "confirm";
    prompt: string;
    confirmLabel?: string;
    cancelLabel?: string;
    timeoutMs?: number;
}

/** 文本输入请求 */
export interface TextRequest {
    type: "text";
    prompt: string;
    placeholder?: string;
    defaultValue?: string;
    maxLength?: number;
    timeoutMs?: number;
}

/** HITL 请求联合类型 */
export type HITLRequest = SelectRequest | ConfirmRequest | TextRequest;

// ── Response Types ──

/** 选择响应（单选） */
export interface SelectSingleResponse {
    type: "select";
    multiple: false;
    /** 选择的值，null 表示选择了自定义输入 */
    selected: string | null;
    /** 自定义输入的文本（当 selected 为 null 时） */
    customText?: string;
    /** 匹配错误信息 */
    error?: string;
}

/** 选择响应（多选） */
export interface SelectMultipleResponse {
    type: "select";
    multiple: true;
    /** 选择的值列表 */
    selected: string[];
    /** 是否包含自定义输入 */
    hasCustom: boolean;
    /** 自定义输入的文本 */
    customText?: string;
    /** 匹配错误信息 */
    error?: string;
}

/** 确认响应 */
export interface ConfirmResponse {
    type: "confirm";
    confirmed: boolean;
}

/** 文本响应 */
export interface TextResponse {
    type: "text";
    text: string;
}

/** 拒绝响应 */
export interface RejectResponse {
    type: "reject";
    reason?: string;
}

/** 超时响应 */
export interface TimeoutResponse {
    type: "timeout";
}

/** HITL 响应联合类型 */
export type HITLResponse = SelectSingleResponse | SelectMultipleResponse | ConfirmResponse | TextResponse | RejectResponse | TimeoutResponse;

/** 根据请求类型推导对应的响应类型（不含 timeout/reject） */
export interface HITLResponseTypeMap {
    select: SelectSingleResponse | SelectMultipleResponse;
    confirm: ConfirmResponse;
    text: TextResponse;
}

/** result() 方法返回的统一结果 */
export interface HITLResult<V> {
    ok: boolean;
    error: "timeout" | "reject" | null;
    value: V | null;
}

/** 根据请求类型推导 value 的类型 */
export type HITLRequestValue<T extends HITLRequest> =
    T extends SelectRequest ? (string | string[]) :
    T extends ConfirmRequest ? boolean :
    T extends TextRequest ? string :
    never;

/** session.wait() 的泛型返回类型：原始响应 + result() 方法 */
export type HITLWaitResult<T extends HITLRequest> =
    (HITLResponseTypeMap[T["type"]] | TimeoutResponse | RejectResponse) & {
        result(): HITLResult<HITLRequestValue<T>>;
    };

/**
 * 给 HITL 响应附加 result() 方法，根据 request 类型推导 value 类型。
 * 在 wait() 内部调用，对调用方透明。
 */
export function attachResult<T extends HITLRequest>(
    response: HITLResponse,
    request: T,
): HITLWaitResult<T> {
    const result = (): HITLResult<HITLRequestValue<T>> => {
        if (response.type === "timeout") {
            return { ok: false, error: "timeout", value: null };
        }
        if (response.type === "reject") {
            return { ok: false, error: "reject", value: null };
        }

        switch (request.type) {
            case "select": {
                const r = response as SelectSingleResponse | SelectMultipleResponse;
                const value = (r.selected ?? r.customText ?? null) as HITLRequestValue<T>;
                return { ok: value != null, error: null, value };
            }
            case "confirm": {
                const r = response as ConfirmResponse;
                return { ok: true, error: null, value: r.confirmed as HITLRequestValue<T> };
            }
            case "text": {
                const r = response as TextResponse;
                return { ok: true, error: null, value: r.text as HITLRequestValue<T> };
            }
            default:
                return { ok: false, error: null, value: null };
        }
    };

    return Object.assign(response, { result }) as HITLWaitResult<T>;
}

// ── Default Match Functions ──

/**
 * 默认的选项匹配函数
 * 支持：数字索引（1-based）、value、label
 */
export function defaultOptionMatch(option: SelectOption, input: string, index: number): MatchResult {
    const trimmed = input.trim();

    // 匹配数字索引（1-based）
    if (trimmed === String(index + 1)) {
        return { matched: true, value: option.value };
    }

    // 匹配 value（不区分大小写）
    if (trimmed.toLowerCase() === option.value.toLowerCase()) {
        return { matched: true, value: option.value };
    }

    // 匹配 label（不区分大小写）
    if (trimmed.toLowerCase() === option.label.toLowerCase()) {
        return { matched: true, value: option.value };
    }

    return { matched: false };
}

/**
 * 在选项列表中查找匹配的选项
 * @returns 匹配结果，包含匹配的值或错误信息
 */
export function findMatchingOption(options: SelectOption[], input: string): MatchResult {
    const trimmed = input.trim();

    for (let i = 0; i < options.length; i++) {
        const option = options[i];

        // 使用自定义 match 函数（如果提供）
        if (option.match) {
            const result = option.match(trimmed);
            if (result.matched) {
                return result;
            }
            // 如果自定义 match 返回了错误，直接返回
            if (result.error) {
                return result;
            }
        } else {
            // 使用默认匹配逻辑
            const result = defaultOptionMatch(option, trimmed, i);
            if (result.matched) {
                return result;
            }
        }
    }

    // 没有匹配到任何选项
    return {
        matched: false,
        error: `无效的选项: "${trimmed}"，请重新选择`,
    };
}

// ── Helper Functions ──

/**
 * 创建单选请求
 */
export function createSelectRequest(
    prompt: string,
    options: SelectOption[],
    opts?: {
        allowCustom?: boolean;
        customLabel?: string;
        customPlaceholder?: string;
        timeoutMs?: number;
    },
    onError?: (rawInput: string, error: string) => void,
): SelectRequest {
    return {
        type: "select",
        prompt,
        options,
        allowCustom: opts?.allowCustom ?? false,
        customLabel: opts?.customLabel ?? "其他",
        customPlaceholder: opts?.customPlaceholder ?? "请输入自定义内容...",
        multiple: false,
        timeoutMs: opts?.timeoutMs ?? 30000,
        onError,
    };
}

/**
 * 创建多选请求
 */
export function createMultiSelectRequest(
    prompt: string,
    options: SelectOption[],
    opts?: {
        allowCustom?: boolean;
        customLabel?: string;
        customPlaceholder?: string;
        minSelect?: number;
        maxSelect?: number;
        timeoutMs?: number;
    },
    onError?: (rawInput: string, error: string) => void,
): SelectRequest {
    return {
        type: "select",
        prompt,
        options,
        allowCustom: opts?.allowCustom ?? false,
        customLabel: opts?.customLabel ?? "其他",
        customPlaceholder: opts?.customPlaceholder ?? "请输入自定义内容...",
        multiple: true,
        minSelect: opts?.minSelect,
        maxSelect: opts?.maxSelect,
        timeoutMs: opts?.timeoutMs ?? 30000,
        onError,
    };
}

/**
 * 创建确认请求
 */
export function createConfirmRequest(
    prompt: string,
    opts?: {
        confirmLabel?: string;
        cancelLabel?: string;
        timeoutMs?: number;
    }
): ConfirmRequest {
    return {
        type: "confirm",
        prompt,
        confirmLabel: opts?.confirmLabel ?? "确认",
        cancelLabel: opts?.cancelLabel ?? "取消",
        timeoutMs: opts?.timeoutMs ?? 30000,
    };
}

/**
 * 创建文本输入请求
 */
export function createTextRequest(
    prompt: string,
    opts?: {
        placeholder?: string;
        defaultValue?: string;
        maxLength?: number;
        timeoutMs?: number;
    }
): TextRequest {
    return {
        type: "text",
        prompt,
        placeholder: opts?.placeholder ?? "请输入...",
        defaultValue: opts?.defaultValue,
        maxLength: opts?.maxLength,
        timeoutMs: opts?.timeoutMs ?? 30000,
    };
}

/**
 * 检查响应是否为选择响应
 */
export function isSelectResponse(response: HITLResponse): response is SelectSingleResponse | SelectMultipleResponse {
    return response.type === "select";
}

/**
 * 检查响应是否为确认响应
 */
export function isConfirmResponse(response: HITLResponse): response is ConfirmResponse {
    return response.type === "confirm";
}

/**
 * 检查响应是否为文本响应
 */
export function isTextResponse(response: HITLResponse): response is TextResponse {
    return response.type === "text";
}

/**
 * 检查响应是否为拒绝响应
 */
export function isRejectResponse(response: HITLResponse): response is RejectResponse {
    return response.type === "reject";
}

/**
 * 检查响应是否为超时响应
 */
export function isTimeoutResponse(response: HITLResponse): response is TimeoutResponse {
    return response.type === "timeout";
}
