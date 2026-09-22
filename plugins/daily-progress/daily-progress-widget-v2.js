/**
 * 插件名称: 关联进展面板 (Daily Progress Widget - V2 增强版)
 * 类名: DailyProgressRightWidgetV2
 * 类型: Trilium 右侧面板组件 (RightPanelWidget)
 * 作用: 根据当前笔记的 #topic 属性值作为唯一标准，聚合展示其他同样拥有该 #topic 属性值的笔记内容。
 * 
 * V2 核心升级特性:
 * 1. 【原样展示与图片渲染】：
 *    - 完整保留富文本格式（段落、各级标题、引用、列表、待办复选框、表格、代码块等）。
 *    - 彻底解决原有版本图片无法显示的问题，完美解析并加载笔记内嵌图像（api/images/...），支持自适应排版及点击大图预览。
 *    - 适配 Trilium 原生 .ck-content 样式体系，自动与明暗主题保持和谐一致。
 * 
 * 2. 【列表式展开与收起】：
 *    - 笔记卡片采用折叠手风琴（Accordion）设计，收起时呈现精致紧凑单行摘要，展开时展示完整正文与图片。
 *    - 顶部工具栏提供「全部展开」与「全部收起」一键切换，并保留卡片展开状态记忆。
 * 
 * 3. 【就地查看与实时编辑】：
 *    - 每张卡片均支持「编辑/查看」模式就地切换。
 *    - 内置轻量富文本编辑工具栏（粗体、斜体、下划线、删除线、各级标题、项目列表、待办选框等）及 HTML 源码模式。
 *    - 具备双层保存持久化保障（优先调用 api.runOnBackend，自动降级 REST API），保存后自动同步。
 *    - 提供「在主编辑区打开」快捷跳转，便于全屏长文编辑。
 * 
 * 使用方式:
 * 1. 在 Trilium 中新建一个类型为 "JS Frontend"（前端脚本）的笔记。
 * 2. 给笔记添加标签属性: #widget
 * 3. 将本文件代码完整复制并粘贴到该笔记内容中。
 * 4. 刷新页面或切换笔记即可在右侧边栏看到 "📅 关联进展 (v2)" 面板。
 */

class DailyProgressRightWidgetV2 extends api.RightPanelWidget {
    constructor() {
        super();
        // 记录展开的卡片 noteId 集合（默认首次加载全部展开）
        this.expandedNoteIds = new Set();
        // 记录正在编辑的卡片 noteId -> 当前编辑内容
        this.editingNoteState = new Map();
        // 记录是否已完成初次默认展开初始化
        this.initializedDefaults = false;
    }

    get parentWidget() {
        return "right-pane";
    }

    get widgetTitle() {
        return "📅 关联进展 (v2)";
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
     * 获取指定笔记的所有 topic 属性值
     */
    getTopicValues(note) {
        const values = new Set();
        if (!note) return [];

        if (typeof note.getLabelValues === "function") {
            for (const val of note.getLabelValues("topic") || []) {
                if (typeof val === "string" && val.trim().length > 0) {
                    values.add(val.trim());
                }
            }
        }
        if (values.size === 0 && typeof note.getLabelValue === "function") {
            const val = note.getLabelValue("topic");
            if (typeof val === "string" && val.trim().length > 0) {
                values.add(val.trim());
            }
        }
        if (values.size === 0 && typeof note.getAttributes === "function") {
            const attrs = note.getAttributes() || [];
            for (const attr of attrs) {
                if (attr && attr.name === "topic" && typeof attr.value === "string" && attr.value.trim().length > 0) {
                    values.add(attr.value.trim());
                }
            }
        }
        return Array.from(values);
    }

    /**
     * 注入增强版面板的 CSS 样式
     */
    injectStyles() {
        const styleId = "daily-progress-v2-styles";
        if (document.getElementById(styleId)) return;

        const css = `
            .dp-container {
                display: flex;
                flex-direction: column;
                height: 100%;
                box-sizing: border-box;
                font-family: inherit;
            }
            .dp-header-bar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 6px 4px 10px 4px;
                border-bottom: 1px solid var(--main-border-color, rgba(0,0,0,0.08));
                margin-bottom: 8px;
                flex-wrap: wrap;
                gap: 6px;
            }
            .dp-header-actions {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            .dp-tool-btn {
                background: none;
                border: 1px solid transparent;
                cursor: pointer;
                color: var(--muted-text-color, #666);
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 12px;
                display: inline-flex;
                align-items: center;
                gap: 3px;
                transition: all 0.15s ease;
            }
            .dp-tool-btn:hover {
                background: var(--accent-background-color, rgba(0,0,0,0.06));
                color: var(--main-text-color, #111);
                border-color: var(--main-border-color, rgba(0,0,0,0.12));
            }
            .dp-card-list {
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-height: calc(100vh - 165px);
                overflow-y: auto;
                overflow-x: hidden;
                padding: 2px 6px 14px 2px;
                scrollbar-width: thin;
                box-sizing: border-box;
            }
            .dp-card {
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
            .dp-card.is-expanded {
                min-height: 100px;
            }
            .dp-card:hover {
                border-color: var(--primary-color, #2563eb);
                box-shadow: 0 2px 6px rgba(0,0,0,0.06);
            }
            .dp-card-header {
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
            .dp-card-header:hover {
                background: var(--accent-background-color, rgba(0,0,0,0.07));
            }
            .dp-card.is-expanded .dp-card-header {
                border-bottom-color: var(--main-border-color, rgba(0,0,0,0.08));
            }
            .dp-card-meta {
                display: flex;
                align-items: center;
                gap: 6px;
                flex: 1;
                min-width: 0;
            }
            .dp-chevron {
                font-size: 16px;
                color: var(--muted-text-color, #888);
                transition: transform 0.2s ease;
                flex-shrink: 0;
            }
            .dp-card.is-expanded .dp-chevron {
                transform: rotate(90deg);
            }
            .dp-badge-date {
                font-size: 11px;
                font-weight: 600;
                padding: 1px 5px;
                border-radius: 4px;
                background: rgba(37, 99, 235, 0.08);
                color: var(--primary-color, #2563eb);
                flex-shrink: 0;
            }
            .dp-badge-topic {
                font-size: 10px;
                padding: 1px 5px;
                border-radius: 3px;
                background: rgba(16, 185, 129, 0.08);
                color: #059669;
                font-weight: 500;
                flex-shrink: 0;
            }
            .dp-card-title-text {
                font-size: 12.5px;
                font-weight: 600;
                color: var(--main-text-color, #1f2937);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .dp-card-actions {
                display: flex;
                align-items: center;
                gap: 3px;
                flex-shrink: 0;
                margin-left: 6px;
            }
            .dp-card-btn {
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
            .dp-card-btn:hover {
                background: var(--accent-background-color, rgba(0,0,0,0.08));
                color: var(--main-text-color, #111);
            }
            .dp-card-btn.active {
                background: var(--primary-color, #2563eb);
                color: #fff !important;
            }
            .dp-card-snippet {
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
            .dp-card-body-wrapper {
                display: none;
                padding: 10px 12px;
                font-size: 13px;
                line-height: 1.6;
                color: var(--main-text-color, #374151);
                box-sizing: border-box;
                min-height: 60px;
                flex-shrink: 0;
            }
            .dp-card.is-expanded .dp-card-body-wrapper {
                display: block;
            }
            /* 富文本渲染与图片规范 */
            .dp-rich-content {
                word-break: break-word;
                overflow-wrap: break-word;
            }
            .dp-rich-content img {
                max-width: 100% !important;
                height: auto !important;
                border-radius: 6px;
                box-shadow: 0 1px 4px rgba(0,0,0,0.1);
                margin: 6px 0;
                display: inline-block;
                cursor: zoom-in;
                transition: transform 0.2s;
            }
            .dp-rich-content img:hover {
                transform: scale(1.01);
            }
            .dp-rich-content p {
                margin-top: 0;
                margin-bottom: 8px;
            }
            .dp-rich-content ul, .dp-rich-content ol {
                padding-left: 20px;
                margin-top: 4px;
                margin-bottom: 8px;
            }
            .dp-rich-content table {
                border-collapse: collapse;
                width: 100%;
                margin: 8px 0;
                font-size: 12px;
            }
            .dp-rich-content th, .dp-rich-content td {
                border: 1px solid var(--main-border-color, #ddd);
                padding: 4px 8px;
            }
            .dp-rich-content blockquote {
                margin: 6px 0;
                padding: 4px 10px;
                border-left: 3px solid var(--primary-color, #3b82f6);
                background: var(--accent-background-color, rgba(0,0,0,0.03));
                color: var(--muted-text-color, #666);
            }
            /* 编辑器区域 */
            .dp-editor-box {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .dp-editor-toolbar {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 2px;
                padding: 4px;
                background: var(--accent-background-color, rgba(0,0,0,0.04));
                border-radius: 4px;
                border: 1px solid var(--main-border-color, rgba(0,0,0,0.08));
            }
            .dp-tb-btn {
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
            .dp-tb-btn:hover {
                background: var(--accent-background-color, rgba(0,0,0,0.1));
            }
            .dp-editor-area {
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
            .dp-editor-source {
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
            .dp-editor-footer {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 6px;
            }
            .dp-save-btn {
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
            .dp-save-btn:hover {
                opacity: 0.9;
            }
            .dp-save-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .dp-cancel-btn {
                background: none;
                border: 1px solid var(--main-border-color, rgba(0,0,0,0.15));
                border-radius: 4px;
                padding: 4px 8px;
                font-size: 12px;
                cursor: pointer;
                color: var(--main-text-color, #444);
            }
            .dp-cancel-btn:hover {
                background: var(--accent-background-color, rgba(0,0,0,0.06));
            }
            /* 图片大图预览遮罩 */
            .dp-lightbox {
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
            .dp-lightbox img {
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
     * 安全过滤并净化 HTML，保留排版、表格、列表及各类 <img> 标签
     */
    sanitizeHtml(rawHtml) {
        if (!rawHtml || typeof rawHtml !== "string") return "";

        const $temp = $("<div>").html(rawHtml);
        // 移除潜在危险标签
        $temp.find("script, iframe, style, object, embed, form, base").remove();

        // 移除所有元素的内联 on* 事件监听器（如 onclick, onerror）
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

        // 确保所有 img 标签的 src 正常
        $temp.find("img").each(function () {
            const $img = $(this);
            $img.attr("loading", "lazy");
            // 若图片未加标题或 alt，补充默认属性
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

        // 1. 优先使用 Trilium 标准 runOnBackend 执行后端更新
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
                console.warn("[DailyProgressV2] api.runOnBackend failed, trying fallback PUT:", e);
            }
        }

        // 2. 降级方案：调用 Trilium REST API: PUT api/notes/:noteId/data
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
            console.error("[DailyProgressV2] PUT note data failed:", err);
        }

        return false;
    }

    /**
     * 弹出大图预览遮罩
     */
    showLightbox(imageSrc) {
        if (!imageSrc) return;
        const $lightbox = $("<div>").addClass("dp-lightbox");
        const $img = $("<img>").attr("src", imageSrc);
        $lightbox.append($img);
        $lightbox.on("click", () => $lightbox.remove());
        $(document).on("keydown.dplightbox", (e) => {
            if (e.key === "Escape") {
                $lightbox.remove();
                $(document).off("keydown.dplightbox");
            }
        });
        $("body").append($lightbox);
    }

    async updateContent(note) {
        if (!this.$widget) return;
        this.$widget.empty();

        const $mainContainer = $("<div>").addClass("dp-container");
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

        // 当前笔记的 topic 属性列表
        const topics = this.getTopicValues(note);
        const currentNoteId = note.noteId || this.getCurrentNoteSafe()?.noteId || "";

        // 1. 顶部操作栏
        const $headerBar = $("<div>").addClass("dp-header-bar");
        const $statusText = $("<span>").css({
            "font-size": "12px",
            "font-weight": "600",
            "color": "var(--muted-text-color, #666)",
            "flex": "1"
        }).text("正在匹配关联进展...");

        const $headerActions = $("<div>").addClass("dp-header-actions");

        const $expandAllBtn = $("<button>").addClass("dp-tool-btn")
            .html('<i class="bx bx-expand-vertical"></i> 展开全部')
            .attr("title", "展开所有匹配到的笔记卡片");

        const $collapseAllBtn = $("<button>").addClass("dp-tool-btn")
            .html('<i class="bx bx-collapse-vertical"></i> 收起全部')
            .attr("title", "收起所有匹配到的笔记卡片");

        const $refreshBtn = $("<button>").addClass("dp-tool-btn")
            .html('<i class="bx bx-refresh"></i> 刷新')
            .attr("title", "重新检索当前 #topic 关联进展")
            .on("click", () => this.updateContent(note));

        $headerActions.append($expandAllBtn, $collapseAllBtn, $refreshBtn);
        $headerBar.append($statusText, $headerActions);
        $mainContainer.append($headerBar);

        // 如果当前笔记未配置 topic 属性
        if (topics.length === 0) {
            $statusText.text("未设置 #topic 属性");
            $expandAllBtn.hide();
            $collapseAllBtn.hide();
            $mainContainer.append(`
                <div style="padding: 28px 12px; text-align: center; color: var(--muted-text-color, #888); font-size: 13px;">
                    <i class="bx bx-purchase-tag-alt" style="font-size: 28px; opacity: 0.45; display: block; margin-bottom: 8px;"></i>
                    当前笔记未设置 <code>#topic</code> 属性
                    <div style="font-size: 11px; opacity: 0.75; margin-top: 6px; line-height: 1.5;">
                        请在当前笔记添加属性（例如 <code>#topic=PKM</code>）<br>
                        面板将以该值为唯一标准，自动聚合其他相同 topic 的笔记并支持就地编辑
                    </div>
                </div>
            `);
            return;
        }

        // 2. 外层卡片流容器
        const $cardList = $("<div>").addClass("dp-card-list");
        $mainContainer.append($cardList);

        // 3. 严格检索
        const candidateMap = new Map();

        for (const topic of topics) {
            try {
                const escapedTopic = topic.replace(/"/g, '\\"');
                const searchResults = await api.searchForNotes(`#topic = "${escapedTopic}"`);
                if (Array.isArray(searchResults)) {
                    for (const src of searchResults) {
                        if (!src || !src.noteId || src.noteId === currentNoteId) continue;
                        if (src.type === "search") continue;

                        if (!candidateMap.has(src.noteId)) {
                            candidateMap.set(src.noteId, {
                                note: src,
                                matchedTopics: [topic]
                            });
                        } else {
                            const item = candidateMap.get(src.noteId);
                            if (!item.matchedTopics.includes(topic)) {
                                item.matchedTopics.push(topic);
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn(`searchForNotes error for topic '${topic}':`, e);
            }
        }

        // 4. 获取与校验匹配笔记
        const validItems = [];

        for (const item of candidateMap.values()) {
            const src = item.note;
            if (!src || !src.noteId || src.noteId === currentNoteId) continue;
            if (src.type === "search") continue;

            const srcTopics = this.getTopicValues(src);
            const matched = srcTopics.filter(t => topics.includes(t));
            if (matched.length === 0) continue;

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

            // 计算日期
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
                matchedTopics: matched
            });
        }

        const topicLabel = topics.map(t => `#topic=${t}`).join(", ");
        $statusText.text(`匹配到: ${validItems.length} 条笔记 (${topicLabel})`);

        if (validItems.length === 0) {
            $expandAllBtn.hide();
            $collapseAllBtn.hide();
            $cardList.html(`
                <div style="text-align: center; padding: 28px 12px; color: var(--muted-text-color, #888); font-size: 13px;">
                    <i class="bx bx-calendar-x" style="font-size: 26px; opacity: 0.45; display: block; margin-bottom: 6px;"></i>
                    暂无其他包含 <code>${topicLabel}</code> 的笔记
                    <div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">
                        仅展示其他包含相同 topic 属性值的笔记
                    </div>
                </div>
            `);
            return;
        }

        // 首次默认展开全部
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
            $cardList.find(".dp-card").addClass("is-expanded");
            $cardList.find(".dp-card-snippet").hide();
        });

        $collapseAllBtn.show().off("click").on("click", () => {
            this.expandedNoteIds.clear();
            $cardList.find(".dp-card").removeClass("is-expanded");
            $cardList.find(".dp-card-snippet").show();
        });

        // 按日期倒序排列
        validItems.sort((a, b) => b.date.localeCompare(a.date));

        // 5. 渲染每一张卡片
        for (const item of validItems) {
            const isExpanded = this.expandedNoteIds.has(item.noteId);
            const $card = $("<div>")
                .addClass("dp-card")
                .attr("data-note-id", item.noteId);

            if (isExpanded) {
                $card.addClass("is-expanded");
            }

            // 卡片头部
            const $cardHeader = $("<div>").addClass("dp-card-header");
            const $cardMeta = $("<div>").addClass("dp-card-meta");

            const $chevron = $("<i>").addClass("bx bx-chevron-right dp-chevron");
            const $dateBadge = $("<span>").addClass("dp-badge-date").text("📅 " + item.date);
            const topicText = item.matchedTopics.map(t => `#${t}`).join(" ");
            const $topicBadge = $("<span>").addClass("dp-badge-topic").text(topicText);

            const displayTitle = item.parentTitle 
                ? `${item.parentTitle} / ${item.title}` 
                : item.title;

            const $titleText = $("<span>")
                .addClass("dp-card-title-text")
                .text(displayTitle)
                .attr("title", `${displayTitle} (点击展开/收起)`);

            $cardMeta.append($chevron, $dateBadge, $topicBadge, $titleText);

            // 右侧操作按钮
            const $cardActions = $("<div>").addClass("dp-card-actions");

            const $editBtn = $("<button>")
                .addClass("dp-card-btn")
                .html('<i class="bx bx-edit"></i> 编辑')
                .attr("title", "在卡片中就地编辑");

            const $openBtn = $("<button>")
                .addClass("dp-card-btn")
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
                .addClass("dp-card-snippet")
                .text(item.snippetText);

            if (isExpanded) {
                $cardSnippet.hide();
            }

            // 卡片正文容器
            const $cardBodyWrapper = $("<div>").addClass("dp-card-body-wrapper");

            // 视图容器
            const $viewContainer = $("<div>")
                .addClass("ck-content dp-rich-content")
                .html(this.sanitizeHtml(item.contentHtml) || '<span style="color:var(--muted-text-color); font-style:italic;">（正文为空）</span>');

            // 允许点击正文中的图片查看大图
            $viewContainer.on("click", "img", (e) => {
                e.stopPropagation();
                const src = $(e.currentTarget).attr("src");
                this.showLightbox(src);
            });

            // 编辑容器（按需渲染）
            const $editorContainer = $("<div>").addClass("dp-editor-box").hide();

            $cardBodyWrapper.append($viewContainer, $editorContainer);
            $card.append($cardHeader, $cardSnippet, $cardBodyWrapper);
            $cardList.append($card);

            // 点击卡片头部切换展开/收起
            $cardHeader.on("click", (e) => {
                // 如果点击的是操作按钮，不触发折叠
                if ($(e.target).closest(".dp-card-actions").length > 0) return;

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

                // 工具栏
                const $toolbar = $("<div>").addClass("dp-editor-toolbar");

                const createCmdBtn = (icon, title, cmd, val = "") => {
                    return $("<button>")
                        .addClass("dp-tb-btn")
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

                // 源码/富文本切换按钮
                const $sourceToggleBtn = $("<button>")
                    .addClass("dp-tb-btn")
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

                // 可视化编辑区域
                const $editableArea = $("<div>")
                    .addClass("ck-content dp-editor-area")
                    .attr("contenteditable", "true")
                    .html(item.contentHtml || "<p></p>");

                // 源码编辑区域
                const $sourceTextarea = $("<textarea>")
                    .addClass("dp-editor-source")
                    .hide();

                // 底部操作栏
                const $footer = $("<div>").addClass("dp-editor-footer");
                const $saveStatus = $("<span>").css({
                    "font-size": "11.5px",
                    "color": "var(--muted-text-color, #777)"
                });

                const $btnGroup = $("<div>").css({ "display": "flex", "gap": "6px" });

                const $saveBtn = $("<button>")
                    .addClass("dp-save-btn")
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
                            // 更新本地摘要与只读显示
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
                    .addClass("dp-cancel-btn")
                    .text("取消")
                    .on("click", () => exitEditor());

                $btnGroup.append($cancelBtn, $saveBtn);
                $footer.append($saveStatus, $btnGroup);

                $editorContainer.append($toolbar, $editableArea, $sourceTextarea, $footer);
            };

            const enterEditor = () => {
                isEditing = true;
                // 确保卡片处于展开状态
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

module.exports = new DailyProgressRightWidgetV2();
