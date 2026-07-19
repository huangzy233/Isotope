export const PRODUCT_SPEC_PATH = ".project/memory/product-spec.md";
export const DECISIONS_PATH = ".project/memory/decisions.md";

/** decisions.md 磁盘上最多保留的段落数（写入时裁剪）。 */
export const DECISIONS_FILE_MAX = 50;

/** 注入 LLM context 时取尾部段落数（见 buildTurnContext）。 */
export const DECISIONS_CONTEXT_TAIL = 20;
