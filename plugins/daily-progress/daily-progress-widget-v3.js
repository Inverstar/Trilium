/**
 * 插件名称: 关联进展面板 (Daily Progress Widget - V3 逻辑表达式增强版)
 * 类名: DailyProgressRightWidgetV3
 * 类型: Trilium 右侧面板组件 (RightPanelWidget)
 * 作用: 支持 topic、theme、tag 多维度属性的逻辑组合筛选（与、或、非、括号分组）。
 * 
 * V3 核心特性:
 * 1. 【多维度属性组合筛选】：
 *    - 支持同时提取并组合当前笔记的 #topic、#theme、#tag 属性。
 *    - 支持灵活的布尔逻辑表达式：如「A与C或B」、「A与C非B」、「(A 或 B) 与 C」、「topic=A 与 tag=C 非 theme=B」。
 *    - 智能语义兼容：
 *      - 与（AND）：与、且、and、AND、&&、&、空格
 *      - 或（OR）：或、or、OR、||、|
 *      - 非（NOT）：非、not、NOT、!、~
 *      - 分组括号：( ) 与 （ ）
 *      - 自然省略支持：如「A与C非B」自动解析为 (A 与 C) 且 (非 B)
 * 2. 【交互式表达式控制台】：
 *    - 面板顶部提供快捷属性徽章（点击一键追加至表达式）。
 *    - 快速逻辑符号按钮（与、或、非、括号）。
 *    - 常用预设快捷按钮（全与 AND、全或 OR、常用模板）。
 *    - 支持实时语法检测与自然语言逻辑释义（如："需包含 A 和 C，且不包含 B"）。
 *    - 支持「一键保存规则至笔记」（写入当前笔记的 #progressFilter 属性持久化）。
 * 3. 【完整继承 V2 旗舰体验】：
 *    - 原样富文本呈现与图片渲染（自适应侧栏、点击大图 Lightbox 预览）。
 *    - 手风琴卡片列表（单张卡片折叠/展开、顶部全部展开/收起）。
 *    - 就地富文本编辑与源码编辑、双层持久化保存（runOnBackend + REST API 降级）。
 *    - 按日期倒序排列，清晰分类展示匹配属性（topic、theme、tag 专属色彩标签）。
 * 
 * 使用方式:
 * 1. 在 Trilium 中新建一个类型为 "JS Frontend"（前端脚本）的笔记。
 * 2. 给笔记添加标签属性: #widget
 * 3. 将本文件代码完整复制并粘贴到该笔记内容中。
 * 4. 刷新页面或切换笔记即可在右侧边栏看到 "📅 关联进展 (v3)" 面板。
 */

// ==========================================
// 表达式解析与 AST 评估引擎
// ==========================================
class ExpressionParser {
    /**
     * 将输入字符串词法分析为 Token 流
     */
    static tokenize(input) {
        if (!input || typeof input !== "string") return [];
        const str = input.trim();
        const tokens = [];
        let i = 0;

        while (i < str.length) {
            const ch = str[i];

            // 跳过空白
            if (/\s/.test(ch)) {
                i++;
                continue;
            }

            // 括号（支持中英文括号）
            if (ch === '(' || ch === '（') {
                tokens.push({ type: 'LPAREN', value: '(' });
                i++;
                continue;
            }
            if (ch === ')' || ch === '）') {
                tokens.push({ type: 'RPAREN', value: ')' });
                i++;
                continue;
            }

            // 双字符操作符
            if (str.startsWith('&&', i)) {
                tokens.push({ type: 'AND', value: 'AND' });
                i += 2;
                continue;
            }
            if (str.startsWith('||', i)) {
                tokens.push({ type: 'OR', value: 'OR' });
                i += 2;
                continue;
            }

            // 单字符与关键字操作符
            if (ch === '&' || ch === '+' || ch === '与' || ch === '且') {
                tokens.push({ type: 'AND', value: 'AND' });
                i++;
                continue;
            }
            if (ch === '|' || ch === '或') {
                tokens.push({ type: 'OR', value: 'OR' });
                i++;
                continue;
            }
            if (ch === '!' || ch === '~' || ch === '非') {
                tokens.push({ type: 'NOT', value: 'NOT' });
                i++;
                continue;
            }

            // 英文关键字 and / or / not (要求词边界)
            const remaining = str.slice(i);
            const andMatch = remaining.match(/^and\b/i);
            if (andMatch) {
                tokens.push({ type: 'AND', value: 'AND' });
                i += andMatch[0].length;
                continue;
            }
            const orMatch = remaining.match(/^or\b/i);
            if (orMatch) {
                tokens.push({ type: 'OR', value: 'OR' });
                i += orMatch[0].length;
                continue;
            }
            const notMatch = remaining.match(/^not\b/i);
            if (notMatch) {
                tokens.push({ type: 'NOT', value: 'NOT' });
                i += notMatch[0].length;
                continue;
            }

            // 引号包裹的完整字符串操作数
            if (ch === '"' || ch === "'" || ch === '“' || ch === '”') {
                const quoteChar = ch;
                const endQuote = ch === '“' ? '”' : quoteChar;
                i++;
                let term = '';
                while (i < str.length && str[i] !== endQuote) {
                    if (str[i] === '\\' && i + 1 < str.length) {
                        i++;
                        term += str[i];
                    } else {
                        term += str[i];
                    }
                    i++;
                }
                if (i < str.length) i++; // 跳过结束引号
                if (term.trim()) {
                    tokens.push({ type: 'TERM', value: term.trim() });
                }
                continue;
            }

            // 普通操作数（支持中文、英文、数字、中划线、下划线、以及 key=val / key:val）
            let term = '';
            while (i < str.length) {
                const c = str[i];
                if (/\s/.test(c) || c === '(' || c === ')' || c === '（' || c === '）' ||
                    c === '&' || c === '|' || c === '!' || c === '~' || c === '+' ||
                    c === '与' || c === '且' || c === '或' || c === '非' ||
                    c === '"' || c === "'" || c === '“' || c === '”') {
                    break;
                }
                term += c;
                i++;
            }
            if (term.trim()) {
                tokens.push({ type: 'TERM', value: term.trim() });
            }
        }

        // 智能补全隐式 AND：
        // 例如 "A与C非B" 分词为: TERM(A), AND, TERM(C), NOT, TERM(B)
        // 在 TERM 后面直接跟 NOT 或 LPAREN 或 TERM 时，自动插入 AND 操作符
        const enriched = [];
        for (let idx = 0; idx < tokens.length; idx++) {
            const curr = tokens[idx];
            enriched.push(curr);

            if (idx + 1 < tokens.length) {
                const next = tokens[idx + 1];
                const isCurrOperand = curr.type === 'TERM' || curr.type === 'RPAREN';
                const isNextStarter = next.type === 'TERM' || next.type === 'LPAREN' || next.type === 'NOT';

                if (isCurrOperand && isNextStarter) {
                    enriched.push({ type: 'AND', value: 'AND' });
                }
            }
        }

        return enriched;
    }

    /**
     * 递归下降语法分析生成 AST
     */
    static parse(tokens) {
        if (!tokens || tokens.length === 0) return null;
        let pos = 0;

        function peek() {
            return tokens[pos];
        }

        function match(...types) {
            const token = peek();
            if (token && types.includes(token.type)) {
                pos++;
                return token;
            }
            return null;
        }

        function parseOr() {
            let left = parseAnd();
            while (match('OR')) {
                const right = parseAnd();
                left = { type: 'OR', left, right };
            }
            return left;
        }

        function parseAnd() {
            let left = parseUnary();
            while (match('AND')) {
                const right = parseUnary();
                left = { type: 'AND', left, right };
            }
            return left;
        }

        function parseUnary() {
            if (match('NOT')) {
                const operand = parseUnary();
                return { type: 'NOT', operand };
            }
            return parsePrimary();
        }

        function parsePrimary() {
            if (match('LPAREN')) {
                const expr = parseOr();
                if (!match('RPAREN')) {
                    throw new Error("缺少匹配的闭合右括号 ')'");
                }
                return expr;
            }
            const termToken = match('TERM');
            if (termToken) {
                return { type: 'TERM', value: termToken.value };
            }
            throw new Error(`意外的操作符或符号: '${peek()?.value || 'EOF'}'`);
        }

        const ast = parseOr();
        if (pos < tokens.length) {
            throw new Error(`未解析的多余符号: '${tokens[pos].value}'`);
        }
        return ast;
    }

    /**
     * 从表达式中提取所有操作数（用于向数据库发起预检索）
     */
    static extractTerms(input) {
        try {
            const tokens = this.tokenize(input);
            const terms = new Set();
            for (const t of tokens) {
                if (t.type === 'TERM' && t.value) {
                    let val = t.value;
                    if (val.includes('=')) {
                        val = val.split('=')[1] || '';
                    } else if (val.includes(':')) {
                        val = val.split(':')[1] || '';
                    }
                    val = val.replace(/^["'“”]|["'“”]$/g, '').trim();
                    if (val) terms.add(val);
                }
            }
            return Array.from(terms);
        } catch (e) {
            return [];
        }
    }

    /**
     * 对某篇笔记的属性集评估 AST 是否匹配
     * @param {object} ast
     * @param {{topics: string[], themes: string[], tags: string[], allLabels: Set<string>}} noteAttrs
     */
    static evaluate(ast, noteAttrs) {
        if (!ast) return true;

        switch (ast.type) {
            case 'TERM':
                return this.matchTerm(ast.value, noteAttrs);
            case 'NOT':
                return !this.evaluate(ast.operand, noteAttrs);
            case 'AND':
                return this.evaluate(ast.left, noteAttrs) && this.evaluate(ast.right, noteAttrs);
            case 'OR':
                return this.evaluate(ast.left, noteAttrs) || this.evaluate(ast.right, noteAttrs);
            default:
                return true;
        }
    }

    /**
     * 针对单个操作数检查是否匹配笔记属性
     */
    static matchTerm(term, noteAttrs) {
        if (!term || typeof term !== "string") return false;
        const raw = term.trim();
        let targetKey = "";
        let targetVal = raw;

        if (raw.includes('=')) {
            const parts = raw.split('=');
            targetKey = parts[0].trim().toLowerCase();
            targetVal = parts.slice(1).join('=').trim();
        } else if (raw.includes(':')) {
            const parts = raw.split(':');
            targetKey = parts[0].trim().toLowerCase();
            targetVal = parts.slice(1).join(':').trim();
        }

        // 清理首尾可能残留的引号
        targetVal = targetVal.replace(/^["'“”]|["'“”]$/g, '').trim();
        const targetValLower = targetVal.toLowerCase();

        const matchArray = (arr) => {
            if (!arr || !Array.isArray(arr)) return false;
            return arr.some(v => typeof v === "string" && v.trim().toLowerCase() === targetValLower);
        };

        if (targetKey === 'topic') {
            return matchArray(noteAttrs.topics);
        }
        if (targetKey === 'theme') {
            return matchArray(noteAttrs.themes);
        }
        if (targetKey === 'tag') {
            return matchArray(noteAttrs.tags);
        }

        // 未明确指定 key 时，任一维度匹配即算匹配
        if (matchArray(noteAttrs.topics)) return true;
        if (matchArray(noteAttrs.themes)) return true;
        if (matchArray(noteAttrs.tags)) return true;
        if (noteAttrs.allLabels && noteAttrs.allLabels.has(targetValLower)) return true;

        return false;
    }

    /**
     * 生成人类易读的自然语言逻辑释义
     */
    static explain(ast) {
        if (!ast) return "匹配全部";
        switch (ast.type) {
            case 'TERM':
                return `包含「${ast.value}」`;
            case 'NOT':
                return `不包含(${this.explain(ast.operand)})`;
            case 'AND':
                return `(${this.explain(ast.left)} 且 ${this.explain(ast.right)})`;
            case 'OR':
                return `(${this.explain(ast.left)} 或 ${this.explain(ast.right)})`;
            default:
                return "";
        }
    }
}

// ==========================================
// DailyProgressRightWidgetV3 主面板类
// ==========================================
class DailyProgressRightWidgetV3 extends api.RightPanelWidget {
    constructor() {
        super();
        // 记录展开的卡片 noteId 集合
        this.expandedNoteIds = new Set();
        // 记录正在编辑的卡片 noteId -> 当前编辑内容
        this.editingNoteState = new Map();
        // 记录是否已完成初次默认展开初始化
        this.initializedDefaults = false;
        // 内存中记录每个笔记当前的筛选表达式 noteId -> expr
        this.activeFilterMap = new Map();
        // 记录折叠/展开筛选配置面板状态
        this.isFilterBarVisible = true;
    }

    get parentWidget() {
        return "right-pane";
    }

    get widgetTitle() {
        return "📅 关联进展 (v3)";
    }

    isEnabled() {
        return true;
    }

    async doRenderBody() {
        this.$widget.empty();
        this.injectStyles();
        const note = this.note || this.getCurrentNoteSafe();
        await this.updateContent(note);
    }

    async refreshWithNote(note) {
        await this.updateContent(note);
    }

    getCurrentNoteSafe() {
        try {
            if (typeof api.getActiveContextNote === "function") {
                return api.getActiveContextNote();
            }
        } catch (e) {}
        return null;
    }

    /**
     * 获取指定笔记的某特定属性值列表（支持单值/多值/属性列表各层级兼容）
     */
    getAttributeValues(note, attrName) {
        const values = new Set();
        if (!note) return [];

        if (typeof note.getLabelValues === "function") {
            for (const val of note.getLabelValues(attrName) || []) {
                if (typeof val === "string" && val.trim().length > 0) {
                    values.add(val.trim());
                }
            }
        }
        if (values.size === 0 && typeof note.getLabelValue === "function") {
            const val = note.getLabelValue(attrName);
            if (typeof val === "string" && val.trim().length > 0) {
                values.add(val.trim());
            }
        }
        if (typeof note.getAttributes === "function") {
            const attrs = note.getAttributes() || [];
            for (const attr of attrs) {
                if (attr && attr.name === attrName && typeof attr.value === "string" && attr.value.trim().length > 0) {
                    values.add(attr.value.trim());
                }
            }
        }
        return Array.from(values);
    }

    /**
     * 汇总指定笔记的 topic, theme, tag 及全部标签值
     */
    getNoteAttributesBundle(note) {
        const topics = this.getAttributeValues(note, "topic");
        const themes = this.getAttributeValues(note, "theme");
        const tags = this.getAttributeValues(note, "tag");

        const allLabels = new Set();
        for (const t of topics) allLabels.add(t.toLowerCase());
        for (const t of themes) allLabels.add(t.toLowerCase());
        for (const t of tags) allLabels.add(t.toLowerCase());

        if (note && typeof note.getAttributes === "function") {
            const attrs = note.getAttributes() || [];
            for (const attr of attrs) {
                if (attr && attr.name) {
                    allLabels.add(attr.name.toLowerCase());
                    if (attr.value && typeof attr.value === "string") {
                        allLabels.add(attr.value.trim().toLowerCase());
                    }
                }
            }
        }

        return { topics, themes, tags, allLabels };
    }

    /**
     * 获取笔记持久化的筛选表达式配置
     */
    getSavedFilterExpression(note) {
        if (!note) return "";
        let expr = "";
        if (typeof note.getLabelValue === "function") {
            expr = note.getLabelValue("progressFilter") || note.getLabelValue("filter") || "";
        }
        if (!expr && typeof note.getAttributes === "function") {
            const attrs = note.getAttributes() || [];
            for (const attr of attrs) {
                if (attr && (attr.name === "progressFilter" || attr.name === "filter") && typeof attr.value === "string") {
                    expr = attr.value;
                    break;
                }
            }
        }
        if (!expr && note.noteId) {
            try {
                expr = localStorage.getItem(`dp_v3_filter_${note.noteId}`) || "";
            } catch (e) {}
        }
        return (expr || "").trim();
    }

    /**
     * 持久化筛选表达式到当前笔记属性及本地存储
     */
    async saveFilterExpressionToNote(noteId, filterExpr) {
        if (!noteId) return false;
        try {
            localStorage.setItem(`dp_v3_filter_${noteId}`, filterExpr);
        } catch (e) {}

        if (typeof api.runOnBackend === "function") {
            try {
                const backendFnStr = `
                    (nId, expr) => {
                        const note = api.getNote(nId);
                        if (note) {
                            note.setLabel("progressFilter", expr);
                            return { success: true };
                        }
                        return { success: false, error: "Note not found" };
                    }
                `;
                const res = /** @type {any} */ (await api.runOnBackend(backendFnStr, [noteId, filterExpr]));
                if (res && res.success) {
                    if (typeof api.reloadNotes === "function") {
                        api.reloadNotes([noteId]).catch(() => {});
                    }
                    return true;
                }
            } catch (err) {
                console.warn("[DailyProgressV3] saveFilterExpressionToNote backend error:", err);
            }
        }
        return true;
    }

    /**
     * 注入 V3 定制 CSS 样式
     */
    injectStyles() {
        const styleId = "daily-progress-v3-styles";
        if (document.getElementById(styleId)) return;

        const css = `
            .dp3-container {
                display: flex;
                flex-direction: column;
                height: 100%;
                box-sizing: border-box;
                font-family: inherit;
            }
            .dp3-header-bar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 6px 4px 8px 4px;
                border-bottom: 1px solid var(--main-border-color, rgba(0,0,0,0.08));
                margin-bottom: 8px;
                flex-wrap: wrap;
                gap: 6px;
            }
            .dp3-header-actions {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            .dp3-tool-btn {
                background: none;
                border: 1px solid transparent;
                cursor: pointer;
                color: var(--muted-text-color, #666);
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 11.5px;
                display: inline-flex;
                align-items: center;
                gap: 3px;
                transition: all 0.15s ease;
            }
            .dp3-tool-btn:hover {
                background: var(--accent-background-color, rgba(0,0,0,0.06));
                color: var(--main-text-color, #111);
                border-color: var(--main-border-color, rgba(0,0,0,0.12));
            }
            .dp3-tool-btn.active {
                background: rgba(37, 99, 235, 0.1);
                color: var(--primary-color, #2563eb);
                border-color: rgba(37, 99, 235, 0.3);
            }

            /* 表达式控制台区域 */
            .dp3-filter-panel {
                display: flex;
                flex-direction: column;
                gap: 7px;
                padding: 8px 10px;
                background: var(--accent-background-color, rgba(0,0,0,0.025));
                border: 1px solid var(--main-border-color, rgba(0,0,0,0.08));
                border-radius: 6px;
                margin-bottom: 10px;
                box-sizing: border-box;
            }
            .dp3-chips-row {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 4px;
                font-size: 11px;
            }
            .dp3-chip-label {
                font-size: 10.5px;
                color: var(--muted-text-color, #777);
                margin-right: 2px;
                user-select: none;
            }
            .dp3-attr-chip {
                cursor: pointer;
                padding: 1.5px 6px;
                border-radius: 4px;
                font-size: 11px;
                font-weight: 500;
                display: inline-flex;
                align-items: center;
                gap: 2px;
                border: 1px solid transparent;
                transition: transform 0.1s, opacity 0.15s;
                user-select: none;
            }
            .dp3-attr-chip:hover {
                transform: translateY(-1px);
                opacity: 0.85;
            }
            .dp3-chip-topic {
                background: rgba(16, 185, 129, 0.12);
                color: #059669;
                border-color: rgba(16, 185, 129, 0.25);
            }
            .dp3-chip-theme {
                background: rgba(139, 92, 246, 0.12);
                color: #7c3aed;
                border-color: rgba(139, 92, 246, 0.25);
            }
            .dp3-chip-tag {
                background: rgba(245, 158, 11, 0.12);
                color: #d97706;
                border-color: rgba(245, 158, 11, 0.25);
            }
            .dp3-chip-op {
                background: var(--main-background-color, #fff);
                color: var(--main-text-color, #333);
                border-color: var(--main-border-color, rgba(0,0,0,0.15));
                font-weight: 600;
            }
            .dp3-chip-op:hover {
                background: var(--accent-background-color, rgba(0,0,0,0.08));
            }

            .dp3-input-row {
                display: flex;
                align-items: center;
                gap: 5px;
            }
            .dp3-filter-input {
                flex: 1;
                font-family: inherit;
                font-size: 12px;
                padding: 4px 8px;
                border: 1px solid var(--main-border-color, rgba(0,0,0,0.2));
                border-radius: 4px;
                background: var(--main-background-color, #fff);
                color: var(--main-text-color, #111);
                outline: none;
                transition: border-color 0.15s;
                box-sizing: border-box;
            }
            .dp3-filter-input:focus {
                border-color: var(--primary-color, #2563eb);
                box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
            }
            .dp3-action-btn {
                background: var(--primary-color, #2563eb);
                color: #fff;
                border: none;
                border-radius: 4px;
                padding: 4px 9px;
                font-size: 11.5px;
                font-weight: 500;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 3px;
                white-space: nowrap;
                transition: opacity 0.15s;
            }
            .dp3-action-btn:hover {
                opacity: 0.9;
            }
            .dp3-secondary-btn {
                background: none;
                border: 1px solid var(--main-border-color, rgba(0,0,0,0.15));
                border-radius: 4px;
                padding: 4px 7px;
                font-size: 11px;
                cursor: pointer;
                color: var(--main-text-color, #444);
                display: inline-flex;
                align-items: center;
                gap: 2px;
                white-space: nowrap;
            }
            .dp3-secondary-btn:hover {
                background: var(--accent-background-color, rgba(0,0,0,0.06));
            }

            .dp3-explain-row {
                font-size: 11px;
                color: var(--muted-text-color, #666);
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: 4px;
                border-top: 1px dashed var(--main-border-color, rgba(0,0,0,0.08));
                padding-top: 4px;
            }
            .dp3-explain-text {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                max-width: 100%;
            }
            .dp3-explain-text.has-error {
                color: #dc2626;
                font-weight: 500;
            }

            /* 卡片流区域 */
            .dp3-card-list {
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-height: calc(100vh - 210px);
                overflow-y: auto;
                overflow-x: hidden;
                padding: 2px 6px 14px 2px;
                scrollbar-width: thin;
                box-sizing: border-box;
            }
            .dp3-card {
                display: flex;
                flex-direction: column;
                border-radius: 8px;
                background: var(--main-background-color, #ffffff);
                border: 1px solid var(--main-border-color, rgba(0,0,0,0.1));
                box-shadow: 0 1px 3px rgba(0,0,0,0.03);
                box-sizing: border-box;
                overflow: hidden;
                transition: border-color 0.2s, box-shadow 0.2s;
                flex-shrink: 0;
                min-height: 68px;
            }
            .dp3-card.is-expanded {
                min-height: 100px;
            }
            .dp3-card:hover {
                border-color: var(--primary-color, #2563eb);
                box-shadow: 0 2px 6px rgba(0,0,0,0.06);
            }
            .dp3-card-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 9px 12px;
                min-height: 42px;
                box-sizing: border-box;
                background: var(--accent-background-color, rgba(0,0,0,0.03));
                cursor: pointer;
                user-select: none;
                border-bottom: 1px solid transparent;
                transition: background 0.15s;
                flex-shrink: 0;
            }
            .dp3-card-header:hover {
                background: var(--accent-background-color, rgba(0,0,0,0.07));
            }
            .dp3-card.is-expanded .dp3-card-header {
                border-bottom-color: var(--main-border-color, rgba(0,0,0,0.08));
            }
            .dp3-card-meta {
                display: flex;
                align-items: center;
                gap: 5px;
                flex: 1;
                min-width: 0;
                flex-wrap: wrap;
            }
            .dp3-chevron {
                font-size: 16px;
                color: var(--muted-text-color, #888);
                transition: transform 0.2s ease;
                flex-shrink: 0;
            }
            .dp3-card.is-expanded .dp3-chevron {
                transform: rotate(90deg);
            }
            .dp3-badge-date {
                font-size: 11px;
                font-weight: 600;
                padding: 1px 5px;
                border-radius: 4px;
                background: rgba(37, 99, 235, 0.08);
                color: var(--primary-color, #2563eb);
                flex-shrink: 0;
            }
            .dp3-badge-topic {
                font-size: 10px;
                padding: 1px 5px;
                border-radius: 3px;
                background: rgba(16, 185, 129, 0.08);
                color: #059669;
                font-weight: 500;
                flex-shrink: 0;
            }
            .dp3-badge-theme {
                font-size: 10px;
                padding: 1px 5px;
                border-radius: 3px;
                background: rgba(139, 92, 246, 0.08);
                color: #7c3aed;
                font-weight: 500;
                flex-shrink: 0;
            }
            .dp3-badge-tag {
                font-size: 10px;
                padding: 1px 5px;
                border-radius: 3px;
                background: rgba(245, 158, 11, 0.08);
                color: #d97706;
                font-weight: 500;
                flex-shrink: 0;
            }
            .dp3-card-title-text {
                font-size: 12.5px;
                font-weight: 600;
                color: var(--main-text-color, #1f2937);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                max-width: 100%;
            }
            .dp3-card-actions {
                display: flex;
                align-items: center;
                gap: 3px;
                flex-shrink: 0;
                margin-left: 6px;
            }
            .dp3-card-btn {
                background: none;
                border: none;
                cursor: pointer;
                padding: 3px 5px;
                border-radius: 4px;
                font-size: 11.5px;
                color: var(--muted-text-color, #666);
                display: inline-flex;
                align-items: center;
                gap: 2px;
                transition: background 0.15s, color 0.15s;
            }
            .dp3-card-btn:hover {
                background: var(--accent-background-color, rgba(0,0,0,0.08));
                color: var(--main-text-color, #111);
            }
            .dp3-card-btn.active {
                background: var(--primary-color, #2563eb);
                color: #fff !important;
            }
            .dp3-card-snippet {
                padding: 7px 12px 8px 12px;
                font-size: 11.5px;
                color: var(--muted-text-color, #777);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                background: var(--main-background-color, #fff);
                display: block;
                min-height: 28px;
                box-sizing: border-box;
                flex-shrink: 0;
            }
            .dp3-card-body-wrapper {
                display: none;
                padding: 10px 12px;
                font-size: 13px;
                line-height: 1.6;
                color: var(--main-text-color, #374151);
                box-sizing: border-box;
                min-height: 60px;
                flex-shrink: 0;
            }
            .dp3-card.is-expanded .dp3-card-body-wrapper {
                display: block;
            }

            /* 富文本与内嵌图片排版 */
            .dp3-rich-content {
                word-break: break-word;
                overflow-wrap: break-word;
            }
            .dp3-rich-content img {
                max-width: 100% !important;
                height: auto !important;
                border-radius: 6px;
                box-shadow: 0 1px 4px rgba(0,0,0,0.1);
                margin: 6px 0;
                display: inline-block;
                cursor: zoom-in;
                transition: transform 0.2s;
            }
            .dp3-rich-content img:hover {
                transform: scale(1.01);
            }
            .dp3-rich-content p {
                margin-top: 0;
                margin-bottom: 8px;
            }
            .dp3-rich-content ul, .dp3-rich-content ol {
                padding-left: 20px;
                margin-top: 4px;
                margin-bottom: 8px;
            }
            .dp3-rich-content table {
                border-collapse: collapse;
                width: 100%;
                margin: 8px 0;
                font-size: 12px;
            }
            .dp3-rich-content th, .dp3-rich-content td {
                border: 1px solid var(--main-border-color, #ddd);
                padding: 4px 8px;
            }
            .dp3-rich-content blockquote {
                margin: 6px 0;
                padding: 4px 10px;
                border-left: 3px solid var(--primary-color, #3b82f6);
                background: var(--accent-background-color, rgba(0,0,0,0.03));
                color: var(--muted-text-color, #666);
            }

            /* 卡片就地编辑器 */
            .dp3-editor-box {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .dp3-editor-toolbar {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 2px;
                padding: 4px;
                background: var(--accent-background-color, rgba(0,0,0,0.04));
                border-radius: 4px;
                border: 1px solid var(--main-border-color, rgba(0,0,0,0.08));
            }
            .dp3-tb-btn {
                background: none;
                border: none;
                cursor: pointer;
                padding: 3px 6px;
                border-radius: 3px;
                font-size: 13px;
                color: var(--main-text-color, #333);
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            .dp3-tb-btn:hover {
                background: var(--accent-background-color, rgba(0,0,0,0.1));
            }
            .dp3-editor-area {
                min-height: 90px;
                max-height: 380px;
                overflow-y: auto;
                padding: 8px;
                border: 1px solid var(--primary-color, #3b82f6);
                border-radius: 6px;
                background: var(--main-background-color, #fff);
                color: var(--main-text-color, #111);
                outline: none;
                font-size: 13px;
                line-height: 1.6;
            }
            .dp3-editor-source {
                min-height: 100px;
                max-height: 350px;
                font-family: monospace;
                font-size: 12px;
                padding: 8px;
                border: 1px solid var(--primary-color, #3b82f6);
                border-radius: 6px;
                background: var(--main-background-color, #fff);
                color: var(--main-text-color, #111);
                resize: vertical;
                outline: none;
                width: 100%;
                box-sizing: border-box;
            }
            .dp3-editor-footer {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 6px;
            }
            .dp3-save-btn {
                background: var(--primary-color, #2563eb);
                color: #fff;
                border: none;
                border-radius: 4px;
                padding: 4px 10px;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 3px;
                transition: opacity 0.15s;
            }
            .dp3-save-btn:hover {
                opacity: 0.9;
            }
            .dp3-save-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .dp3-cancel-btn {
                background: none;
                border: 1px solid var(--main-border-color, rgba(0,0,0,0.15));
                border-radius: 4px;
                padding: 4px 8px;
                font-size: 12px;
                cursor: pointer;
                color: var(--main-text-color, #444);
            }
            .dp3-cancel-btn:hover {
                background: var(--accent-background-color, rgba(0,0,0,0.06));
            }

            /* Lightbox 大图预览遮罩 */
            .dp3-lightbox {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.75);
                z-index: 999999;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: zoom-out;
            }
            .dp3-lightbox img {
                max-width: 90vw;
                max-height: 90vh;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            }
        `;

        const styleEl = document.createElement("style");
        styleEl.id = styleId;
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
    }

    /**
     * 安全过滤并净化 HTML
     */
    sanitizeHtml(rawHtml) {
        if (!rawHtml || typeof rawHtml !== "string") return "";

        const $temp = $("<div>").html(rawHtml);
        $temp.find("script, iframe, style, object, embed, form, base").remove();

        $temp.find("*").each(function () {
            const attrs = this.attributes;
            if (attrs) {
                const toRemove = [];
                for (let i = 0; i < attrs.length; i++) {
                    const attrName = attrs[i].name;
                    if (attrName.toLowerCase().startsWith("on") || attrName.toLowerCase() === "javascript:") {
                        toRemove.push(attrName);
                    }
                }
                for (const a of toRemove) {
                    this.removeAttribute(a);
                }
            }
        });

        $temp.find("img").each(function () {
            const $img = $(this);
            $img.attr("loading", "lazy");
            if (!$img.attr("alt")) {
                $img.attr("alt", "笔记内嵌图片");
            }
        });

        return $temp.html();
    }

    /**
     * 保存笔记正文持久化到 Trilium
     */
    async saveNoteContent(noteId, newHtmlContent) {
        if (!noteId) return false;

        if (typeof api.runOnBackend === "function") {
            try {
                const backendFnStr = `
                    (nId, cnt) => {
                        const note = api.getNote(nId);
                        if (note) {
                            note.setContent(cnt);
                            return { success: true };
                        }
                        return { success: false, error: "Note not found" };
                    }
                `;
                const result = /** @type {any} */ (await api.runOnBackend(backendFnStr, [noteId, newHtmlContent]));

                if (result && result.success) {
                    if (typeof api.reloadNotes === "function") {
                        api.reloadNotes([noteId]).catch(() => {});
                    }
                    return true;
                }
            } catch (e) {
                console.warn("[DailyProgressV3] api.runOnBackend failed, trying fallback PUT:", e);
            }
        }

        try {
            const glob = /** @type {any} */ (window).glob;
            /** @type {Record<string, string>} */
            const headers = { "Content-Type": "application/json" };
            if (glob && glob.csrfToken) {
                headers["x-csrf-token"] = glob.csrfToken;
            }
            if (glob && glob.componentId) {
                headers["trilium-component-id"] = glob.componentId;
            }

            const response = await fetch(`api/notes/${encodeURIComponent(noteId)}/data`, {
                method: "PUT",
                headers: headers,
                body: JSON.stringify({ content: newHtmlContent })
            });

            if (response.ok) {
                if (typeof api.reloadNotes === "function") {
                    api.reloadNotes([noteId]).catch(() => {});
                }
                return true;
            }
        } catch (err) {
            console.error("[DailyProgressV3] PUT note data failed:", err);
        }

        return false;
    }

    /**
     * 弹出大图预览遮罩
     */
    showLightbox(imageSrc) {
        if (!imageSrc) return;
        const $lightbox = $("<div>").addClass("dp3-lightbox");
        const $img = $("<img>").attr("src", imageSrc);
        $lightbox.append($img);
        $lightbox.on("click", () => $lightbox.remove());
        $(document).on("keydown.dp3lightbox", (e) => {
            if (e.key === "Escape") {
                $lightbox.remove();
                $(document).off("keydown.dp3lightbox");
            }
        });
        $("body").append($lightbox);
    }

    /**
     * 核心渲染与数据刷新流程
     */
    async updateContent(note) {
        if (!this.$widget) return;
        this.$widget.empty();

        const $mainContainer = $("<div>").addClass("dp3-container");
        this.$widget.append($mainContainer);

        if (!note) {
            $mainContainer.html(`
                <div style="padding: 24px 12px; text-align: center; color: var(--muted-text-color, #888); font-size: 13px;">
                    <i class="bx bx-notepad" style="font-size: 24px; opacity: 0.5; display: block; margin-bottom: 6px;"></i>
                    请选择笔记查看关联进展
                </div>
            `);
            return;
        }

        const currentNoteId = note.noteId || this.getCurrentNoteSafe()?.noteId || "";
        const currentBundle = this.getNoteAttributesBundle(note);
        const { topics, themes, tags } = currentBundle;

        // 当前所有属性总集合
        const hasAnyAttr = topics.length > 0 || themes.length > 0 || tags.length > 0;

        // 确定当前使用的筛选表达式：
        // 1. 优先内存中该笔记的编辑状态
        // 2. 其次持久化配置（#progressFilter / #filter / localStorage）
        // 3. 再次默认表达式（若有多属性组合默认 AND；若无则为空）
        let activeExpr = this.activeFilterMap.get(currentNoteId);
        if (typeof activeExpr !== "string") {
            activeExpr = this.getSavedFilterExpression(note);
        }
        if (typeof activeExpr !== "string" || !activeExpr.trim()) {
            if (hasAnyAttr) {
                // 默认拼接：优先 topic，与 tag，与 theme
                const defaultTerms = [];
                for (const t of topics) defaultTerms.push(t);
                for (const t of tags) defaultTerms.push(t);
                for (const t of themes) defaultTerms.push(t);
                activeExpr = defaultTerms.join(" 与 ");
            } else {
                activeExpr = "";
            }
        }

        // 1. 顶部操作栏
        const $headerBar = $("<div>").addClass("dp3-header-bar");
        const $statusText = $("<span>").css({
            "font-size": "12px",
            "font-weight": "600",
            "color": "var(--muted-text-color, #666)",
            "flex": "1"
        }).text("正在匹配关联笔记...");

        const $headerActions = $("<div>").addClass("dp3-header-actions");

        const $filterToggleBtn = $("<button>").addClass("dp3-tool-btn")
            .html('<i class="bx bx-slider-alt"></i> 筛选器')
            .attr("title", "展开/收起高级表达式筛选面板")
            .toggleClass("active", this.isFilterBarVisible);

        const $expandAllBtn = $("<button>").addClass("dp3-tool-btn")
            .html('<i class="bx bx-expand-vertical"></i> 展开全部')
            .attr("title", "展开所有匹配到的笔记卡片");

        const $collapseAllBtn = $("<button>").addClass("dp3-tool-btn")
            .html('<i class="bx bx-collapse-vertical"></i> 收起全部')
            .attr("title", "收起所有匹配到的笔记卡片");

        const $refreshBtn = $("<button>").addClass("dp3-tool-btn")
            .html('<i class="bx bx-refresh"></i> 刷新')
            .attr("title", "重新检索匹配笔记")
            .on("click", () => this.updateContent(note));

        $headerActions.append($filterToggleBtn, $expandAllBtn, $collapseAllBtn, $refreshBtn);
        $headerBar.append($statusText, $headerActions);
        $mainContainer.append($headerBar);

        // 2. 交互式表达式控制台 (Filter Panel)
        const $filterPanel = $("<div>").addClass("dp3-filter-panel");
        if (!this.isFilterBarVisible) {
            $filterPanel.hide();
        }

        $filterToggleBtn.on("click", () => {
            this.isFilterBarVisible = !this.isFilterBarVisible;
            $filterToggleBtn.toggleClass("active", this.isFilterBarVisible);
            if (this.isFilterBarVisible) {
                $filterPanel.slideDown(150);
            } else {
                $filterPanel.slideUp(150);
            }
        });

        // 2.1 当前笔记属性徽章行（支持一键点击追加）
        const $chipsRow = $("<div>").addClass("dp3-chips-row");
        $chipsRow.append('<span class="dp3-chip-label">快捷标签:</span>');

        const appendToInput = (text) => {
            const $input = $filterPanel.find(".dp3-filter-input");
            const val = String($input.val() || "");
            if (!val.trim()) {
                $input.val(text);
            } else {
                $input.val(`${val.trim()} ${text}`);
            }
            $input.focus();
            triggerExpressionUpdate(String($input.val() || ""));
        };

        if (topics.length > 0) {
            for (const t of topics) {
                $("<button>").addClass("dp3-attr-chip dp3-chip-topic")
                    .html(`<span>#topic:</span> <b>${t}</b>`)
                    .attr("title", `点击插入 topic: ${t}`)
                    .on("click", () => appendToInput(t))
                    .appendTo($chipsRow);
            }
        }
        if (themes.length > 0) {
            for (const t of themes) {
                $("<button>").addClass("dp3-attr-chip dp3-chip-theme")
                    .html(`<span>#theme:</span> <b>${t}</b>`)
                    .attr("title", `点击插入 theme: ${t}`)
                    .on("click", () => appendToInput(t))
                    .appendTo($chipsRow);
            }
        }
        if (tags.length > 0) {
            for (const t of tags) {
                $("<button>").addClass("dp3-attr-chip dp3-chip-tag")
                    .html(`<span>#tag:</span> <b>${t}</b>`)
                    .attr("title", `点击插入 tag: ${t}`)
                    .on("click", () => appendToInput(t))
                    .appendTo($chipsRow);
            }
        }

        // 逻辑操作符按钮
        const opGroup = [
            { label: "与", text: "与" },
            { label: "或", text: "或" },
            { label: "非", text: "非" },
            { label: "(", text: "(" },
            { label: ")", text: ")" },
        ];
        for (const op of opGroup) {
            $("<button>").addClass("dp3-attr-chip dp3-chip-op")
                .text(op.label)
                .attr("title", `插入操作符 ${op.label}`)
                .on("click", () => appendToInput(op.text))
                .appendTo($chipsRow);
        }

        // 2.2 表达式输入行
        const $inputRow = $("<div>").addClass("dp3-input-row");
        const $filterInput = $("<input>")
            .addClass("dp3-filter-input")
            .attr("placeholder", "输入表达式，例如: A与C或B、A与C非B、(A或B)与C")
            .val(activeExpr);

        const $applyBtn = $("<button>")
            .addClass("dp3-action-btn")
            .html('<i class="bx bx-check"></i> 筛选')
            .attr("title", "应用当前表达式重新过滤");

        const $saveRuleBtn = $("<button>")
            .addClass("dp3-secondary-btn")
            .html('<i class="bx bx-save"></i> 设为默认')
            .attr("title", "保存该表达式为当前笔记的默认筛选规则");

        $inputRow.append($filterInput, $applyBtn, $saveRuleBtn);

        // 2.3 逻辑释义与预设行
        const $explainRow = $("<div>").addClass("dp3-explain-row");
        const $explainText = $("<span>").addClass("dp3-explain-text").text("规则解析中...");
        
        const $presetWrap = $("<div>").css({ "display": "flex", "gap": "4px" });
        const createPresetBtn = (label, expr) => {
            return $("<button>").addClass("dp3-secondary-btn")
                .css({ "font-size": "10.5px", "padding": "1px 5px" })
                .text(label)
                .on("click", () => {
                    $filterInput.val(expr);
                    triggerExpressionUpdate(expr, true);
                });
        };

        if (hasAnyAttr) {
            const allItems = [...topics, ...tags, ...themes];
            if (allItems.length >= 2) {
                $presetWrap.append(createPresetBtn("全包含(AND)", allItems.join(" 与 ")));
                $presetWrap.append(createPresetBtn("任一包含(OR)", allItems.join(" 或 ")));
            }
            if (topics.length > 0 && tags.length > 0 && themes.length > 0) {
                $presetWrap.append(createPresetBtn("A与C非B", `${topics[0]} 与 ${tags[0]} 非 ${themes[0]}`));
            }
        }

        $explainRow.append($explainText, $presetWrap);
        $filterPanel.append($chipsRow, $inputRow, $explainRow);
        $mainContainer.append($filterPanel);

        // 3. 卡片容器
        const $cardList = $("<div>").addClass("dp3-card-list");
        $mainContainer.append($cardList);

        // 4. 解析与检索逻辑
        let currentAst = null;

        const updateExplanation = (exprStr) => {
            if (!exprStr || !exprStr.trim()) {
                $explainText.removeClass("has-error").text("未设置筛选条件，将展示所有备选笔记");
                currentAst = null;
                return true;
            }
            try {
                const tokens = ExpressionParser.tokenize(exprStr);
                const ast = ExpressionParser.parse(tokens);
                currentAst = ast;
                $explainText.removeClass("has-error").text("规则: " + ExpressionParser.explain(ast));
                return true;
            } catch (err) {
                currentAst = null;
                const errMsg = err instanceof Error ? err.message : String(err || "格式有误");
                $explainText.addClass("has-error").text("⚠️ 表达式错误: " + errMsg);
                return false;
            }
        };

        updateExplanation(activeExpr);

        // 统一触发筛选更新
        const triggerExpressionUpdate = (newExpr, doFullSearch = false) => {
            this.activeFilterMap.set(currentNoteId, newExpr);
            const isValid = updateExplanation(newExpr);
            if (!isValid) return;

            if (doFullSearch) {
                // 如果引入了全新的关键词，重新执行全局查询
                this.updateContent(note);
            } else {
                // 原地快速基于候选池重新评估过滤
                this.renderFilteredList(currentAst, candidateMap, currentNoteId, $cardList, $statusText, $expandAllBtn, $collapseAllBtn);
            }
        };

        $filterInput.on("input", () => {
            triggerExpressionUpdate(String($filterInput.val() || ""), false);
        });

        $filterInput.on("keydown", (e) => {
            if (e.key === "Enter") {
                triggerExpressionUpdate(String($filterInput.val() || ""), true);
            }
        });

        $applyBtn.on("click", () => {
            triggerExpressionUpdate(String($filterInput.val() || ""), true);
        });

        $saveRuleBtn.on("click", async () => {
            const exprToSave = String($filterInput.val() || "").trim();
            $saveRuleBtn.prop("disabled", true).html('<i class="bx bx-loader-alt bx-spin"></i> 保存中');
            const ok = await this.saveFilterExpressionToNote(currentNoteId, exprToSave);
            if (ok) {
                $saveRuleBtn.html('<i class="bx bx-check"></i> 已保存');
                setTimeout(() => {
                    $saveRuleBtn.prop("disabled", false).html('<i class="bx bx-save"></i> 设为默认');
                }, 1200);
            } else {
                $saveRuleBtn.prop("disabled", false).html('<i class="bx bx-x"></i> 保存失败');
            }
        });

        // 5. 广度候选笔记检索
        // 提取表达式中的所有操作数 + 当前笔记已有属性
        const searchTerms = new Set([
            ...topics,
            ...themes,
            ...tags,
            ...ExpressionParser.extractTerms(activeExpr)
        ]);

        if (searchTerms.size === 0) {
            $statusText.text("未指定筛选属性");
            $expandAllBtn.hide();
            $collapseAllBtn.hide();
            $cardList.html(`
                <div style="padding: 28px 12px; text-align: center; color: var(--muted-text-color, #888); font-size: 13px;">
                    <i class="bx bx-filter-alt" style="font-size: 28px; opacity: 0.45; display: block; margin-bottom: 8px;"></i>
                    当前笔记未设置 <code>#topic</code>、<code>#theme</code> 或 <code>#tag</code>
                    <div style="font-size: 11px; opacity: 0.75; margin-top: 6px; line-height: 1.5;">
                        在上方筛选框直接输入表达式（如 <code>A与C非B</code>）<br>
                        或在当前笔记添加属性即可自动激活智能多维聚合
                    </div>
                </div>
            `);
            return;
        }

        const candidateMap = new Map();

        for (const term of searchTerms) {
            try {
                const escaped = term.replace(/"/g, '\\"');
                // 分别检索 topic, theme, tag 属性
                const queries = [
                    `#topic = "${escaped}"`,
                    `#theme = "${escaped}"`,
                    `#tag = "${escaped}"`
                ];

                for (const q of queries) {
                    try {
                        const searchResults = await api.searchForNotes(q);
                        if (Array.isArray(searchResults)) {
                            for (const src of searchResults) {
                                if (!src || !src.noteId || src.noteId === currentNoteId) continue;
                                if (src.type === "search") continue;
                                if (!candidateMap.has(src.noteId)) {
                                    candidateMap.set(src.noteId, src);
                                }
                            }
                        }
                    } catch (err) {}
                }
            } catch (e) {
                console.warn(`[DailyProgressV3] searchForNotes error for '${term}':`, e);
            }
        }

        // 6. 过滤与渲染
        await this.renderFilteredList(currentAst, candidateMap, currentNoteId, $cardList, $statusText, $expandAllBtn, $collapseAllBtn);
    }

    /**
     * 根据当前 AST 在 candidateMap 中过滤并渲染卡片流
     */
    async renderFilteredList(ast, candidateMap, currentNoteId, $cardList, $statusText, $expandAllBtn, $collapseAllBtn) {
        $cardList.empty();

        const validItems = [];

        for (const src of candidateMap.values()) {
            if (!src || !src.noteId || src.noteId === currentNoteId) continue;
            if (src.type === "search") continue;

            const noteBundle = this.getNoteAttributesBundle(src);

            // 执行 AST 逻辑表达式评估
            const isMatch = ExpressionParser.evaluate(ast, noteBundle);
            if (!isMatch) continue;

            // 获取原样 HTML 正文
            let rawContent = "";
            let snippetText = "";
            if (src.getContent) {
                try {
                    const c = await src.getContent();
                    if (typeof c === "string" && c.trim()) {
                        rawContent = c;
                        const $temp = $("<div>").html(c);
                        $temp.find("script, style, iframe").remove();
                        snippetText = $temp.text().trim().slice(0, 75);
                    }
                } catch (e) {}
            }

            // 计算时间线日期
            let dateStr = "";
            let parentTitle = "";

            if (src.getParentNotes) {
                const parents = src.getParentNotes();
                if (Array.isArray(parents) && parents.length > 0 && parents[0]) {
                    parentTitle = parents[0].title || "";
                    const match = parentTitle.match(/\d{4}-\d{2}-\d{2}/);
                    if (match) dateStr = match[0];
                }
            }

            if (!dateStr && src.getLabelValue) {
                dateStr = src.getLabelValue("dateNote") || "";
            }
            if (!dateStr && src.title) {
                const match = src.title.match(/\d{4}-\d{2}-\d{2}/);
                if (match) dateStr = match[0];
            }
            if (!dateStr && src.getMetadata) {
                try {
                    const meta = await src.getMetadata();
                    if (meta && meta.dateCreated) {
                        dateStr = meta.dateCreated.slice(0, 10);
                    }
                } catch (e) {}
            }

            validItems.push({
                noteId: src.noteId,
                title: src.title || "未命名笔记",
                parentTitle,
                date: dateStr || "未知日期",
                contentHtml: rawContent,
                snippetText: snippetText || "（暂无文字摘要）",
                matchedTopics: noteBundle.topics,
                matchedThemes: noteBundle.themes,
                matchedTags: noteBundle.tags
            });
        }

        $statusText.text(`匹配到: ${validItems.length} 条笔记`);

        if (validItems.length === 0) {
            $expandAllBtn.hide();
            $collapseAllBtn.hide();
            $cardList.html(`
                <div style="text-align: center; padding: 28px 12px; color: var(--muted-text-color, #888); font-size: 13px;">
                    <i class="bx bx-calendar-x" style="font-size: 26px; opacity: 0.45; display: block; margin-bottom: 6px;"></i>
                    暂无符合当前表达式筛选的笔记
                    <div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">
                        可尝试在上方调整与、或、非条件组合
                    </div>
                </div>
            `);
            return;
        }

        // 默认初始化展开状态
        if (!this.initializedDefaults) {
            for (const item of validItems) {
                this.expandedNoteIds.add(item.noteId);
            }
            this.initializedDefaults = true;
        }

        // 绑定「全部展开」与「全部收起」
        $expandAllBtn.show().off("click").on("click", () => {
            for (const item of validItems) {
                this.expandedNoteIds.add(item.noteId);
            }
            $cardList.find(".dp3-card").addClass("is-expanded");
            $cardList.find(".dp3-card-snippet").hide();
        });

        $collapseAllBtn.show().off("click").on("click", () => {
            this.expandedNoteIds.clear();
            $cardList.find(".dp3-card").removeClass("is-expanded");
            $cardList.find(".dp3-card-snippet").show();
        });

        // 按日期倒序排列
        validItems.sort((a, b) => b.date.localeCompare(a.date));

        // 渲染每一张卡片
        for (const item of validItems) {
            const isExpanded = this.expandedNoteIds.has(item.noteId);
            const $card = $("<div>")
                .addClass("dp3-card")
                .attr("data-note-id", item.noteId);

            if (isExpanded) {
                $card.addClass("is-expanded");
            }

            // 卡片头部
            const $cardHeader = $("<div>").addClass("dp3-card-header");
            const $cardMeta = $("<div>").addClass("dp3-card-meta");

            const $chevron = $("<i>").addClass("bx bx-chevron-right dp3-chevron");
            const $dateBadge = $("<span>").addClass("dp3-badge-date").text("📅 " + item.date);

            $cardMeta.append($chevron, $dateBadge);

            // topic 标签徽章
            if (item.matchedTopics.length > 0) {
                const topicText = item.matchedTopics.map(t => `#${t}`).join(" ");
                $("<span>").addClass("dp3-badge-topic").text(topicText).appendTo($cardMeta);
            }
            // theme 标签徽章
            if (item.matchedThemes.length > 0) {
                const themeText = item.matchedThemes.map(t => `🎨 ${t}`).join(" ");
                $("<span>").addClass("dp3-badge-theme").text(themeText).appendTo($cardMeta);
            }
            // tag 标签徽章
            if (item.matchedTags.length > 0) {
                const tagText = item.matchedTags.map(t => `🏷️ ${t}`).join(" ");
                $("<span>").addClass("dp3-badge-tag").text(tagText).appendTo($cardMeta);
            }

            const displayTitle = item.parentTitle 
                ? `${item.parentTitle} / ${item.title}` 
                : item.title;

            const $titleText = $("<span>")
                .addClass("dp3-card-title-text")
                .text(displayTitle)
                .attr("title", `${displayTitle} (点击展开/收起)`);

            $cardMeta.append($titleText);

            // 右侧操作按钮
            const $cardActions = $("<div>").addClass("dp3-card-actions");

            const $editBtn = $("<button>")
                .addClass("dp3-card-btn")
                .html('<i class="bx bx-edit"></i> 编辑')
                .attr("title", "在卡片中就地编辑");

            const $openBtn = $("<button>")
                .addClass("dp3-card-btn")
                .html('<i class="bx bx-link-external"></i>')
                .attr("title", "在主编辑区打开此笔记")
                .on("click", (e) => {
                    e.stopPropagation();
                    api.activateNote(item.noteId);
                });

            $cardActions.append($editBtn, $openBtn);
            $cardHeader.append($cardMeta, $cardActions);

            // 收起状态下的单行摘要
            const $cardSnippet = $("<div>")
                .addClass("dp3-card-snippet")
                .text(item.snippetText);

            if (isExpanded) {
                $cardSnippet.hide();
            }

            // 卡片正文容器
            const $cardBodyWrapper = $("<div>").addClass("dp3-card-body-wrapper");

            // 视图容器
            const $viewContainer = $("<div>")
                .addClass("ck-content dp3-rich-content")
                .html(this.sanitizeHtml(item.contentHtml) || '<span style="color:var(--muted-text-color); font-style:italic;">（正文为空）</span>');

            // 允许点击正文中的图片查看大图
            $viewContainer.on("click", "img", (e) => {
                e.stopPropagation();
                const src = $(e.currentTarget).attr("src");
                this.showLightbox(src);
            });

            // 编辑容器（按需渲染）
            const $editorContainer = $("<div>").addClass("dp3-editor-box").hide();

            $cardBodyWrapper.append($viewContainer, $editorContainer);
            $card.append($cardHeader, $cardSnippet, $cardBodyWrapper);
            $cardList.append($card);

            // 点击卡片头部切换展开/收起
            $cardHeader.on("click", (e) => {
                if ($(e.target).closest(".dp3-card-actions").length > 0) return;

                const willExpand = !$card.hasClass("is-expanded");
                if (willExpand) {
                    $card.addClass("is-expanded");
                    $cardSnippet.slideUp(150);
                    this.expandedNoteIds.add(item.noteId);
                } else {
                    $card.removeClass("is-expanded");
                    $cardSnippet.slideDown(150);
                    this.expandedNoteIds.delete(item.noteId);
                }
            });

            // 编辑功能配置
            let isEditing = false;
            let isSourceMode = false;

            const setupEditor = () => {
                $editorContainer.empty();

                const $toolbar = $("<div>").addClass("dp3-editor-toolbar");

                const createCmdBtn = (icon, title, cmd, val = "") => {
                    return $("<button>")
                        .addClass("dp3-tb-btn")
                        .html(`<i class="bx ${icon}"></i>`)
                        .attr("title", title)
                        .on("mousedown", (e) => {
                            e.preventDefault();
                            if (isSourceMode) return;
                            document.execCommand(cmd, false, val);
                        });
                };

                $toolbar.append(
                    createCmdBtn("bx-bold", "粗体 (Ctrl+B)", "bold"),
                    createCmdBtn("bx-italic", "斜体 (Ctrl+I)", "italic"),
                    createCmdBtn("bx-underline", "下划线 (Ctrl+U)", "underline"),
                    createCmdBtn("bx-strikethrough", "删除线", "strikeThrough"),
                    createCmdBtn("bx-heading", "三级标题", "formatBlock", "<h3>"),
                    createCmdBtn("bx-list-ul", "无序列表", "insertUnorderedList"),
                    createCmdBtn("bx-list-ol", "有序列表", "insertOrderedList"),
                    createCmdBtn("bx-code", "代码块", "formatBlock", "<pre>")
                );

                const $sourceToggleBtn = $("<button>")
                    .addClass("dp3-tb-btn")
                    .css({ "margin-left": "auto", "font-size": "11.5px", "gap": "2px" })
                    .html('<i class="bx bx-code-alt"></i> 源码')
                    .attr("title", "切换 HTML 源码 / 可视化编辑")
                    .on("click", () => {
                        isSourceMode = !isSourceMode;
                        if (isSourceMode) {
                            $sourceTextarea.val(String($editableArea.html() || ""));
                            $editableArea.hide();
                            $sourceTextarea.show().focus();
                            $sourceToggleBtn.html('<i class="bx bx-show"></i> 可视化').addClass("active");
                        } else {
                            $editableArea.html(String($sourceTextarea.val() || ""));
                            $sourceTextarea.hide();
                            $editableArea.show().focus();
                            $sourceToggleBtn.html('<i class="bx bx-code-alt"></i> 源码').removeClass("active");
                        }
                    });

                $toolbar.append($sourceToggleBtn);

                const $editableArea = $("<div>")
                    .addClass("ck-content dp3-editor-area")
                    .attr("contenteditable", "true")
                    .html(item.contentHtml || "<p></p>");

                const $sourceTextarea = $("<textarea>")
                    .addClass("dp3-editor-source")
                    .hide();

                const $footer = $("<div>").addClass("dp3-editor-footer");
                const $saveStatus = $("<span>").css({
                    "font-size": "11.5px",
                    "color": "var(--muted-text-color, #777)"
                });

                const $btnGroup = $("<div>").css({ "display": "flex", "gap": "6px" });

                const $saveBtn = $("<button>")
                    .addClass("dp3-save-btn")
                    .html('<i class="bx bx-save"></i> 保存')
                    .on("click", async () => {
                        $saveBtn.prop("disabled", true).html('<i class="bx bx-loader-alt bx-spin"></i> 保存中...');
                        $saveStatus.text("");

                        const newContent = String(
                            isSourceMode 
                                ? $sourceTextarea.val() || "" 
                                : $editableArea.html() || ""
                        );

                        const ok = await this.saveNoteContent(item.noteId, newContent);
                        if (ok) {
                            item.contentHtml = newContent;
                            const $tmp = $("<div>").html(newContent);
                            $tmp.find("script, style, iframe").remove();
                            item.snippetText = $tmp.text().trim().slice(0, 75) || "（暂无文字摘要）";
                            $cardSnippet.text(item.snippetText);
                            $viewContainer.html(this.sanitizeHtml(newContent) || '<span style="color:var(--muted-text-color); font-style:italic;">（正文为空）</span>');

                            $saveStatus.css("color", "#059669").text("已保存 ✓");
                            setTimeout(() => {
                                exitEditor();
                            }, 450);
                        } else {
                            $saveBtn.prop("disabled", false).html('<i class="bx bx-save"></i> 保存');
                            $saveStatus.css("color", "#dc2626").text("保存失败，请检查权限");
                        }
                    });

                const $cancelBtn = $("<button>")
                    .addClass("dp3-cancel-btn")
                    .text("取消")
                    .on("click", () => exitEditor());

                $btnGroup.append($cancelBtn, $saveBtn);
                $footer.append($saveStatus, $btnGroup);

                $editorContainer.append($toolbar, $editableArea, $sourceTextarea, $footer);
            };

            const enterEditor = () => {
                isEditing = true;
                $card.addClass("is-expanded");
                $cardSnippet.hide();
                this.expandedNoteIds.add(item.noteId);

                $editBtn.addClass("active").html('<i class="bx bx-check"></i> 退出编辑');
                $viewContainer.hide();
                setupEditor();
                $editorContainer.show();
            };

            const exitEditor = () => {
                isEditing = false;
                $editBtn.removeClass("active").html('<i class="bx bx-edit"></i> 编辑');
                $editorContainer.hide();
                $viewContainer.show();
            };

            $editBtn.on("click", (e) => {
                e.stopPropagation();
                if (!isEditing) {
                    enterEditor();
                } else {
                    exitEditor();
                }
            });
        }
    }
}

module.exports = new DailyProgressRightWidgetV3();
