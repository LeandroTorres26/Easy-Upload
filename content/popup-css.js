// Estilos do popup (aplicados via adoptedStyleSheets dentro do Shadow DOM).
globalThis.EasyUploadPopupCSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel {
      --bg: #ffffff; --fg: #1d1d1f; --muted: #6e6e73; --border: rgba(0,0,0,.12);
      --hover: rgba(0,0,0,.05); --accent: #2563eb; --accent-fg: #fff; --accent-soft: rgba(37,99,235,.12);
      --warn-bg: #fff7e0; --warn-fg: #7a5200; --error: #c62828; --skeleton: rgba(0,0,0,.06);
      color-scheme: light;
      font: 13px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--fg); background: var(--bg);
      border: 1px solid var(--border); border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.08);
      width: 340px; max-width: calc(100vw - 16px);
      max-height: min(480px, calc(100vh - 16px));
      display: flex; flex-direction: column; overflow: hidden;
      text-align: left; direction: ltr;
    }
    @media (prefers-color-scheme: dark) {
      .panel {
        --bg: #1f1f22; --fg: #ececf1; --muted: #9a9aa3; --border: rgba(255,255,255,.12);
        --hover: rgba(255,255,255,.06); --accent: #5b8cff; --accent-soft: rgba(91,140,255,.18);
        --warn-bg: #3a2f12; --warn-fg: #f3d488; --error: #ff8a80; --skeleton: rgba(255,255,255,.07);
        color-scheme: dark;
        box-shadow: 0 12px 32px rgba(0,0,0,.5);
      }
    }
    header { display: flex; align-items: center; gap: 8px; padding: 10px 10px 6px 14px; }
    .title { font-weight: 600; font-size: 13px; }
    .chip {
      font-size: 11px; color: var(--muted); border: 1px solid var(--border);
      border-radius: 999px; padding: 1px 8px; max-width: 140px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .spacer { flex: 1; }
    button { font: inherit; color: inherit; cursor: pointer; }
    button:disabled { cursor: default; }
    .icon {
      border: 0; background: transparent; width: 26px; height: 26px; border-radius: 6px;
      color: var(--muted); font-size: 14px; line-height: 1;
    }
    .icon:hover { background: var(--hover); color: var(--fg); }
    .body { overflow-y: auto; padding: 0 6px 6px; }
    section + section { margin-top: 4px; }
    h3 {
      margin: 8px 8px 4px; font-size: 11px; font-weight: 600; letter-spacing: .04em;
      text-transform: uppercase; color: var(--muted);
    }
    .list { display: flex; flex-direction: column; gap: 1px; }
    .item {
      display: flex; align-items: center; gap: 10px; width: 100%;
      border: 0; background: transparent; text-align: left;
      padding: 6px 8px; border-radius: 8px;
    }
    .item:hover:not(:disabled) { background: var(--hover); }
    .item:focus-visible, .btn:focus-visible, .icon:focus-visible, .link:focus-visible {
      outline: 2px solid var(--accent); outline-offset: -2px;
    }
    .item:disabled { opacity: .42; }
    .item[aria-pressed="true"] { background: var(--accent-soft); }
    .item.loading { opacity: .6; pointer-events: none; }
    .thumb {
      flex: none; width: 40px; height: 40px; border-radius: 6px; overflow: hidden;
      display: grid; place-items: center; font-size: 20px;
      background: var(--hover);
    }
    .thumb img, .thumb canvas { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
    .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .name, .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub { font-size: 11.5px; color: var(--muted); }
    .check {
      flex: none; width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--border);
      display: grid; place-items: center; font-size: 11px; color: transparent;
    }
    .item[aria-pressed="true"] .check { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
    .empty { padding: 8px 10px; color: var(--muted); font-size: 12px; }
    .skeleton { height: 40px; margin: 4px 8px; border-radius: 8px; background: var(--skeleton); animation: pulse 1.2s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: .45; } }
    .banner {
      margin: 2px 6px 6px; padding: 8px 10px; border-radius: 8px;
      background: var(--warn-bg); color: var(--warn-fg); font-size: 12px;
      display: flex; flex-direction: column; gap: 4px; align-items: flex-start;
    }
    .banner[hidden] { display: none; }
    .link { border: 0; background: none; padding: 0; color: inherit; text-decoration: underline; font-weight: 600; }
    .status { padding: 0 14px; font-size: 12px; color: var(--muted); }
    .status:empty { display: none; }
    .status.error { color: var(--error); }
    footer { display: flex; gap: 8px; padding: 8px 10px 10px; border-top: 1px solid var(--border); margin-top: 4px; }
    .btn {
      flex: 1; border: 1px solid var(--border); background: transparent;
      border-radius: 8px; padding: 7px 10px; font-weight: 500; white-space: nowrap;
    }
    footer .btn { flex: 1 1 auto; }
    .btn:hover:not(:disabled) { background: var(--hover); }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
    .btn.primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--accent); }
    .btn:disabled { opacity: .5; }
    .btn[hidden] { display: none; }
  `;
