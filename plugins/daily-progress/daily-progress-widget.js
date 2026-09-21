/**
 * 插件名称: 关联进展面板 (Daily Progress Widget)
 * 类名: DailyProgressRightWidget
 * 类型: Trilium 右侧面板组件 (RightPanelWidget)
 * 作用: 根据当前笔记的 #topic 属性值作为唯一标准，聚合展示其他同样拥有该 #topic 属性值的笔记内容。
 * 
 * 匹配规则:
 * - 获取当前笔记的 #topic 属性值（例如当前笔记设置了 #topic=PKM）。
 * - 检索并展示除当前笔记以外、其他同样包含该 #topic 属性且属性值完全相同的笔记。
 * - 严格以此为唯一筛选条件，按日期倒序卡片流展示。
 * 
 * 使用方式:
 * 1. 在 Trilium 中新建一个类型为 "JS Frontend"（前端脚本）的笔记。
 * 2. 给笔记添加标签属性: #widget
 * 3. 将本文件代码复制并粘贴到该笔记内容中。
 * 4. 刷新页面或切换笔记即可在右侧边栏看到 "📅 关联进展" 面板。
 */

class DailyProgressRightWidget extends api.RightPanelWidget {
    get parentWidget() {
        return "right-pane";
    }

    get widgetTitle() {
        return "📅 关联进展";
    }

    isEnabled() {
        return true;
    }

    async doRenderBody() {
        this.$widget.empty();
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

    async updateContent(note) {
        if (!this.$widget) return;
        this.$widget.empty();

        if (!note) {
            this.$widget.html(`
                <div style="padding: 24px 12px; text-align: center; color: var(--muted-text-color, #888); font-size: 13px;">
                    <i class="bx bx-notepad" style="font-size: 24px; opacity: 0.5; display: block; margin-bottom: 6px;"></i>
                    请选择笔记查看关联进展
                </div>
            `);
            return;
        }

        // 当前笔记的 topic 属性列表
        const topics = this.getTopicValues(note);
        const currentNoteId = note.noteId || (this.getCurrentNoteSafe() ? this.getCurrentNoteSafe().noteId : "");

        // 1. 顶部操作栏
        const $headerBar = $("<div>").css({
            "display": "flex",
            "align-items": "center",
            "justify-content": "space-between",
            "padding": "4px 8px 10px 4px",
            "border-bottom": "1px solid var(--main-border-color, rgba(0,0,0,0.08))",
            "margin-bottom": "10px"
        });

        const $statusText = $("<span>").css({
            "font-size": "12px",
            "font-weight": "600",
            "color": "var(--muted-text-color, #666)"
        }).text("正在匹配关联进展...");

        const $refreshBtn = $("<button>").css({
            "background": "none",
            "border": "none",
            "cursor": "pointer",
            "color": "var(--muted-text-color, #666)",
            "padding": "4px 6px",
            "border-radius": "4px",
            "font-size": "13px",
            "display": "inline-flex",
            "align-items": "center",
            "gap": "3px",
            "transition": "color 0.2s"
        }).html('<i class="bx bx-refresh"></i> 刷新')
          .on("click", () => this.updateContent(note));

        $headerBar.append($statusText, $refreshBtn);
        this.$widget.append($headerBar);

        // 如果当前笔记未配置 topic 属性，则给出明确提示
        if (topics.length === 0) {
            $statusText.text("未设置 #topic 属性");
            this.$widget.append(`
                <div style="padding: 28px 12px; text-align: center; color: var(--muted-text-color, #888); font-size: 13px;">
                    <i class="bx bx-purchase-tag-alt" style="font-size: 28px; opacity: 0.45; display: block; margin-bottom: 8px;"></i>
                    当前笔记未设置 <code>#topic</code> 属性
                    <div style="font-size: 11px; opacity: 0.75; margin-top: 6px; line-height: 1.5;">
                        请在当前笔记添加属性（例如 <code>#topic=PKM</code>）<br>
                        面板将以该值为唯一标准，自动聚合其他相同 topic 的笔记
                    </div>
                </div>
            `);
            return;
        }

        // 2. 外层卡片流容器
        const $cardList = $("<div>").css({
            "display": "flex",
            "flex-direction": "column",
            "gap": "12px",
            "max-height": "calc(100vh - 160px)",
            "overflow-y": "auto",
            "overflow-x": "hidden",
            "padding": "2px 6px 12px 2px",
            "scrollbar-width": "thin",
            "box-sizing": "border-box"
        });
        this.$widget.append($cardList);

        // 3. 严格唯一检索：按当前笔记的每个 topic 值查找其他笔记
        const candidateMap = new Map(); // noteId -> { note, matchedTopics }

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

        // 4. 对收集到的笔记进行严格双重校验（排除自身，确保严格具备匹配的 topic 属性）
        const validItems = [];

        for (const item of candidateMap.values()) {
            const src = item.note;
            if (!src || !src.noteId || src.noteId === currentNoteId) continue;
            if (src.type === "search") continue;

            const srcTopics = this.getTopicValues(src);
            const matched = srcTopics.filter(t => topics.includes(t));
            if (matched.length === 0) continue;

            // 获取正文纯文本
            let contentText = "";
            if (src.getContent) {
                try {
                    const c = await src.getContent();
                    if (typeof c === "string" && c.trim()) {
                        const $temp = $("<div>").html(c);
                        $temp.find("script, style, iframe").remove();
                        contentText = $temp.text().trim();
                    }
                } catch (e) {}
            }

            // 计算日期与父笔记面包屑
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
                content: contentText || "（暂无文本内容）",
                matchedTopics: matched
            });
        }

        const topicLabel = topics.map(t => `#topic=${t}`).join(", ");
        $statusText.text(`匹配到: ${validItems.length} 条笔记 (${topicLabel})`);

        if (validItems.length === 0) {
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

        // 按日期倒序排列（新笔记排在前面）
        validItems.sort((a, b) => b.date.localeCompare(a.date));

        // 5. 渲染卡片流
        for (const item of validItems) {
            const $card = $("<div>").css({
                "display": "flex",
                "flex-direction": "column",
                "padding": "12px 14px",
                "border-radius": "8px",
                "background": "var(--main-background-color, #ffffff)",
                "border": "1px solid var(--main-border-color, rgba(0,0,0,0.1))",
                "box-shadow": "0 1px 3px rgba(0,0,0,0.04)",
                "box-sizing": "border-box",
                "height": "auto",
                "overflow": "visible",
                "flex-shrink": "0",
                "transition": "border-color 0.2s, box-shadow 0.2s"
            });

            // 卡片头部（日期 + Topic 标签）
            const $cardHeader = $("<div>").css({
                "display": "flex",
                "align-items": "center",
                "justify-content": "space-between",
                "margin-bottom": "6px"
            });

            const $dateBadge = $("<span>").css({
                "font-size": "11px",
                "font-weight": "600",
                "padding": "2px 6px",
                "border-radius": "4px",
                "background": "var(--accent-background-color, rgba(0,0,0,0.05))",
                "color": "var(--primary-color, #2563eb)"
            }).text("📅 " + item.date);

            const topicText = item.matchedTopics.map(t => `#topic=${t}`).join(", ");
            const $topicBadge = $("<span>").css({
                "font-size": "10.5px",
                "padding": "1px 6px",
                "border-radius": "3px",
                "background": "rgba(37, 99, 235, 0.08)",
                "color": "var(--primary-color, #2563eb)",
                "font-weight": "500"
            }).text("🏷️ " + topicText);

            $cardHeader.append($dateBadge, $topicBadge);

            // 笔记标题跳转（附带父级目录提示）
            const displayTitle = item.parentTitle 
                ? `${item.parentTitle} / ${item.title}` 
                : item.title;

            const $noteLink = $("<a>").css({
                "font-size": "13px",
                "font-weight": "600",
                "color": "var(--main-text-color, #1f2937)",
                "text-decoration": "none",
                "cursor": "pointer",
                "margin-bottom": "6px",
                "word-break": "break-word"
            }).text(displayTitle)
              .hover(
                  function() { $(this).css("text-decoration", "underline").css("color", "var(--primary-color, #2563eb)"); },
                  function() { $(this).css("text-decoration", "none").css("color", "var(--main-text-color, #1f2937)"); }
              )
              .on("click", (e) => {
                  e.preventDefault();
                  api.activateNote(item.noteId);
              });

            // 正文自适应完全展示
            const $contentBody = $("<div>").css({
                "font-size": "12.5px",
                "line-height": "1.6",
                "color": "var(--main-text-color, #374151)",
                "background": "var(--accent-background-color, rgba(0,0,0,0.02))",
                "border-left": "3px solid var(--primary-color, #3b82f6)",
                "padding": "8px 10px",
                "border-radius": "4px",
                "white-space": "pre-wrap",
                "word-break": "break-word",
                "height": "auto",
                "max-height": "none",
                "overflow": "visible"
            }).text(item.content);

            $card.append($cardHeader, $noteLink, $contentBody);
            $cardList.append($card);
        }
    }
}

module.exports = new DailyProgressRightWidget();
