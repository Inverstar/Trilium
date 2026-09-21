/**
 * 插件名称: 关联进展面板 (Daily Progress Widget)
 * 类名: DailyProgressRightWidget
 * 类型: Trilium 右侧面板组件 (RightPanelWidget)
 * 作用: 自动匹配并汇聚当前笔记的相关进展（支持 ~topic 关联、@提及引用、同名进展笔记），按日期倒序卡片流展示。
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

        // 获取当前正在查看的笔记 ID（排除自身的基准）
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

        // 3. 收集候选笔记
        const candidateMap = new Map(); // noteId -> { note, excerpts, matchType }

        // --- 途径 A: 严格查找 topic 关系（排除自己） ---
        const targetRels = (typeof note.getTargetRelations === "function") ? note.getTargetRelations() : [];
        for (const rel of targetRels) {
            if (rel && rel.name === "topic" && rel.noteId && rel.noteId !== currentNoteId) {
                if (!candidateMap.has(rel.noteId)) {
                    const srcNote = await api.getNote(rel.noteId);
                    if (srcNote && srcNote.noteId !== currentNoteId) {
                        candidateMap.set(rel.noteId, {
                            note: srcNote,
                            excerpts: [],
                            matchType: "topic 关联"
                        });
                    }
                }
            }
        }

        // --- 途径 B: 严格查找 @提及 / 链接（排除自己） ---
        try {
            const baseUrl = (window.glob && window.glob.baseApiUrl) ? window.glob.baseApiUrl : "api/";
            const backlinks = await $.get(baseUrl + "note-map/" + currentNoteId + "/backlinks");
            if (Array.isArray(backlinks)) {
                for (const bl of backlinks) {
                    if (!bl || !bl.noteId || bl.noteId === currentNoteId) continue;
                    
                    const isTopic = bl.relationName === "topic";
                    const hasExcerpts = Array.isArray(bl.excerpts) && bl.excerpts.length > 0;

                    if (isTopic || hasExcerpts) {
                        let item = candidateMap.get(bl.noteId);
                        if (!item) {
                            const srcNote = await api.getNote(bl.noteId);
                            if (srcNote && srcNote.noteId !== currentNoteId) {
                                item = {
                                    note: srcNote,
                                    excerpts: bl.excerpts || [],
                                    matchType: isTopic ? "topic 关联" : "@提及引用"
                                };
                                candidateMap.set(bl.noteId, item);
                            }
                        } else if (hasExcerpts) {
                            item.excerpts = bl.excerpts;
                            if (item.matchType !== "topic 关联") {
                                item.matchType = "@提及引用";
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.warn("backlinks API error:", e);
        }

        // --- 途径 C: 查找同名子笔记/进展笔记（严格排除当前笔记自身） ---
        try {
            const searchNotes = await api.searchForNotes(`# note.title = "${note.title}"`);
            if (Array.isArray(searchNotes)) {
                for (const src of searchNotes) {
                    if (src && src.noteId && src.noteId !== currentNoteId) {
                        if (!candidateMap.has(src.noteId)) {
                            candidateMap.set(src.noteId, {
                                note: src,
                                excerpts: [],
                                matchType: "同名进展"
                            });
                        }
                    }
                }
            }
        } catch (e) {}

        // 4. 对所有收集到的笔记进行严格判定过滤与数据清洗
        const currentTitleLower = (note.title || "").trim().toLowerCase();
        const validItems = [];

        for (const item of candidateMap.values()) {
            const src = item.note;
            // 铁律：坚决排除当前笔记自身
            if (!src || !src.noteId || src.noteId === currentNoteId) continue;
            if (src.type === "search") continue;

            // 获取正文
            let rawContent = "";
            if (src.getContent) {
                try {
                    const c = await src.getContent();
                    if (typeof c === "string") rawContent = c;
                } catch (e) {}
            }

            // 严格三条件校验
            const isTopic = (item.matchType === "topic 关联") || 
                (src.getRelations && src.getRelations("topic").some(r => r.value === currentNoteId || r.value === note.title));
            
            const isSameTitle = src.title && (src.title.trim().toLowerCase() === currentTitleLower);

            const isMention = (item.excerpts && item.excerpts.length > 0) ||
                (rawContent && (rawContent.includes(currentNoteId) || rawContent.includes("@" + note.title)));

            // 必须命中至少一项
            if (!isTopic && !isSameTitle && !isMention) {
                continue;
            }

            const matchBadge = isTopic ? "🏷️ topic 关联" : (isMention ? "🔗 @引用" : "📄 同名进展");

            // 计算日期与父笔记面包屑
            let dateStr = "";
            let parentTitle = "";

            if (src.getParentNotes) {
                const parents = src.getParentNotes();
                if (Array.isArray(parents) && parents.length > 0 && parents[0]) {
                    parentTitle = parents[0].title || "";
                    // 优先从父笔记标题匹配日记日期（如 2026-09-21）
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

            // 提取纯文本正文
            let contentText = "";
            if (item.excerpts && item.excerpts.length > 0) {
                contentText = item.excerpts
                    .map(html => $("<div>").html(html).text().trim())
                    .filter(t => t.length > 0)
                    .join("\n\n");
            }
            if (!contentText && rawContent) {
                const $temp = $("<div>").html(rawContent);
                $temp.find("script, style, iframe").remove();
                contentText = $temp.text().trim();
            }

            validItems.push({
                noteId: src.noteId,
                title: src.title || "未命名笔记",
                parentTitle,
                date: dateStr || "未知日期",
                content: contentText || "（暂无文本内容）",
                matchBadge,
                isSameTitle
            });
        }

        $statusText.text(`精准匹配: ${validItems.length} 条关联进展`);

        if (validItems.length === 0) {
            $cardList.html(`
                <div style="text-align: center; padding: 28px 12px; color: var(--muted-text-color, #888); font-size: 13px;">
                    <i class="bx bx-calendar-x" style="font-size: 26px; opacity: 0.45; display: block; margin-bottom: 6px;"></i>
                    暂无其他关联进展
                    <div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">
                        仅匹配：① @引用本笔记 ② 配置了 ~topic 关系 ③ 其他同名进展笔记
                    </div>
                </div>
            `);
            return;
        }

        // 按日期倒序排列
        validItems.sort((a, b) => b.date.localeCompare(a.date));

        // 5. 渲染卡片
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

            // 卡片头部（日期 + 来源标签）
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

            const $typeBadge = $("<span>").css({
                "font-size": "10px",
                "padding": "1px 5px",
                "border-radius": "3px",
                "background": "rgba(0,0,0,0.04)",
                "color": "var(--muted-text-color, #666)"
            }).text(item.matchBadge);

            $cardHeader.append($dateBadge, $typeBadge);

            // 笔记标题跳转（若为同名笔记，附带父级目录提示）
            const displayTitle = item.isSameTitle && item.parentTitle 
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
