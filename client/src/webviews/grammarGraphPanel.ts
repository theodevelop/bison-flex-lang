export interface GrammarGraphData {
  nodes: { id: string; type: string; line: number; recursive?: boolean; first?: string[]; follow?: string[]; alternatives?: string[][] }[];
  edges: { source: string; target: string }[];
  startSymbol: string;
}

/** Render the grammar graph WebView with Dagre hierarchical layout + D3.js rendering */
export function renderGrammarGraphHtml(data: GrammarGraphData): string {
  const graphJSON = JSON.stringify(data);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Grammar Graph</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
      font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
      overflow: hidden;
      width: 100vw;
      height: 100vh;
    }
    #main-svg { width: 100%; height: 100%; }

    /* ── Edges ── */
    .edge path {
      fill: none;
      stroke: var(--vscode-editorWidget-border, #555);
      stroke-width: 1.5;
    }
    .edge path.self-loop {
      stroke-dasharray: 5,3;
    }
    .edge:hover path { stroke-width: 2.5; stroke-opacity: 1; }

    /* ── Node base ── */
    .node { cursor: pointer; }
    .node rect, .node ellipse {
      stroke-width: 2;
      transition: filter 0.15s;
    }
    .node:hover rect, .node:hover ellipse {
      filter: brightness(1.25);
    }
    .node .label {
      font-size: 12px;
      font-weight: 600;
      fill: #fff;
      text-anchor: middle;
      dominant-baseline: central;
      pointer-events: none;
    }
    .node .alt-text {
      font-size: 10px;
      fill: var(--vscode-editor-foreground, #ccc);
      text-anchor: middle;
      pointer-events: none;
      opacity: 0.85;
    }

    /* ── Color scheme ── */
    .node.start rect      { fill: #2b7bd6; stroke: #5aa3ee; }
    .node.nonterminal rect { fill: #2d8a4e; stroke: #4ec97a; }
    .node.recursive rect   { fill: #c04040; stroke: #e06060; }
    .node.token ellipse    { fill: #555; stroke: #888; }

    /* ── Toolbar ── */
    #toolbar {
      position: fixed; top: 8px; left: 8px;
      display: flex; gap: 6px; z-index: 200;
    }
    #toolbar button {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
      border: none; border-radius: 4px;
      padding: 5px 10px; font-size: 12px;
      cursor: pointer;
      font-family: inherit;
    }
    #toolbar button:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }
    #toolbar button.active {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      outline: 2px solid var(--vscode-focusBorder, #007fd4);
    }

    /* ── Legend ── */
    #legend {
      position: fixed; top: 8px; right: 8px;
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 12px; z-index: 200;
    }
    #legend h4 { margin-bottom: 6px; font-size: 12px; opacity: 0.8; }
    .legend-item { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
    .legend-dot {
      width: 12px; height: 12px; border-radius: 3px; display: inline-block;
      border: 1px solid rgba(255,255,255,0.2);
    }
    .legend-dot.token-dot { border-radius: 50%; }

    /* ── Tooltip ── */
    #tooltip {
      position: fixed; display: none;
      background: var(--vscode-editorHoverWidget-background, #2d2d30);
      border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
      color: var(--vscode-editorHoverWidget-foreground, #d4d4d4);
      padding: 8px 12px; border-radius: 4px;
      font-size: 12px; pointer-events: none;
      z-index: 300; max-width: 400px;
      line-height: 1.5;
    }
    #tooltip .tt-title { font-weight: bold; margin-bottom: 4px; }
    #tooltip .tt-section { margin-top: 4px; }
    #tooltip .tt-label { opacity: 0.7; font-size: 11px; }
    #tooltip code {
      background: rgba(255,255,255,0.08);
      padding: 1px 4px; border-radius: 2px;
      font-size: 11px;
    }

    /* ── Minimap ── */
    #minimap {
      position: fixed; bottom: 12px; right: 12px;
      width: 180px; height: 120px;
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      border-radius: 4px; z-index: 200; overflow: hidden;
    }
    #minimap svg { width: 100%; height: 100%; }
    #minimap .viewport-rect {
      fill: rgba(0,127,212,0.15);
      stroke: var(--vscode-focusBorder, #007fd4);
      stroke-width: 1.5;
    }
  </style>
</head>
<body>
  <div id="toolbar">
    <button id="btn-reset" title="Reset zoom">⟳ Reset</button>
    <button id="btn-compact" class="active" title="Compact view">Compact</button>
    <button id="btn-detailed" title="Show alternatives">Detailed</button>
    <button id="btn-svg" title="Export as SVG">Export SVG</button>
    <button id="btn-png" title="Export as PNG">Export PNG</button>
  </div>

  <div id="legend">
    <h4>Legend</h4>
    <div class="legend-item"><span class="legend-dot" style="background:#2b7bd6"></span> Start symbol (%start)</div>
    <div class="legend-item"><span class="legend-dot" style="background:#2d8a4e"></span> Non-terminal</div>
    <div class="legend-item"><span class="legend-dot" style="background:#c04040"></span> Recursive (cycle)</div>
    <div class="legend-item"><span class="legend-dot token-dot" style="background:#555"></span> Terminal (token)</div>
  </div>

  <div id="tooltip"></div>
  <div id="minimap"><svg></svg></div>

  <svg id="main-svg"></svg>

  <script src="https://d3js.org/d3.v7.min.js"></script>
  <script src="https://unpkg.com/@dagrejs/dagre@1.1.4/dist/dagre.min.js"></script>
  <script>
  (function() {
    const vscode = acquireVsCodeApi();
    const data = ${graphJSON};
    const tooltip = document.getElementById('tooltip');

    // ── State ──
    let displayMode = 'compact'; // 'compact' | 'detailed'
    const NODE_H_COMPACT = 32;
    const NODE_H_DETAILED_BASE = 36;
    const NODE_H_ALT_LINE = 16;
    const NODE_W_MIN = 100;
    const CHAR_W = 7.5;
    const TOKEN_GROUP_THRESHOLD = 50; // group tokens if total rules > 50

    // ── Dagre layout ──
    function computeLayout(mode) {
      const g = new dagre.graphlib.Graph({ compound: true });
      g.setGraph({
        rankdir: 'TB',
        nodesep: 30,
        ranksep: 60,
        marginx: 40,
        marginy: 40,
        acyclicer: 'greedy',
        ranker: 'network-simplex'
      });
      g.setDefaultEdgeLabel(() => ({}));

      const ruleCount = data.nodes.filter(n => n.type === 'rule').length;
      const shouldGroupTokens = ruleCount > TOKEN_GROUP_THRESHOLD;
      const tokenNodes = data.nodes.filter(n => n.type === 'token');
      const ruleNodes = data.nodes.filter(n => n.type === 'rule');

      // Add rule nodes
      for (const n of ruleNodes) {
        let h = NODE_H_COMPACT;
        let label = n.id;
        if (mode === 'detailed' && n.alternatives && n.alternatives.length > 0) {
          h = NODE_H_DETAILED_BASE + n.alternatives.length * NODE_H_ALT_LINE;
        }
        const w = Math.max(NODE_W_MIN, label.length * CHAR_W + 24);
        g.setNode(n.id, { label: n.id, width: w, height: h });
      }

      if (shouldGroupTokens && tokenNodes.length > 0) {
        // Grouped token node
        const groupLabel = tokenNodes.length + ' terminals';
        const w = Math.max(NODE_W_MIN, groupLabel.length * CHAR_W + 24);
        g.setNode('__tokens__', { label: groupLabel, width: w, height: NODE_H_COMPACT });
        // Edges: any rule referencing any token → single edge to group
        const rulesWithTokenEdge = new Set();
        for (const e of data.edges) {
          const targetNode = data.nodes.find(nn => nn.id === e.target);
          if (targetNode && targetNode.type === 'token') {
            if (!rulesWithTokenEdge.has(e.source)) {
              rulesWithTokenEdge.add(e.source);
              g.setEdge(e.source, '__tokens__');
            }
          }
        }
      } else {
        // Individual token nodes
        for (const n of tokenNodes) {
          const w = Math.max(80, n.id.length * CHAR_W + 20);
          g.setNode(n.id, { label: n.id, width: w, height: NODE_H_COMPACT });
        }
      }

      // Add edges (skip token edges if grouped)
      for (const e of data.edges) {
        const sourceInGraph = g.hasNode(e.source);
        const targetInGraph = g.hasNode(e.target);
        if (sourceInGraph && targetInGraph) {
          // Self-loops: dagre doesn't handle them, we'll draw manually
          if (e.source !== e.target) {
            g.setEdge(e.source, e.target);
          }
        } else if (sourceInGraph && shouldGroupTokens) {
          // Target is a token that was grouped
          const targetNode = data.nodes.find(nn => nn.id === e.target);
          if (targetNode && targetNode.type === 'token' && g.hasNode('__tokens__')) {
            // Already handled above
          }
        }
      }

      dagre.layout(g);
      return g;
    }

    // ── Render ──
    function render(mode) {
      displayMode = mode;
      const g = computeLayout(mode);
      const graphInfo = g.graph();
      const gw = graphInfo.width || 800;
      const gh = graphInfo.height || 600;

      const svgEl = d3.select('#main-svg');
      svgEl.selectAll('*').remove();

      svgEl.attr('viewBox', '0 0 ' + gw + ' ' + gh);

      // Defs: arrowhead
      const defs = svgEl.append('defs');
      defs.append('marker')
        .attr('id', 'arrow')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 8).attr('refY', 0)
        .attr('markerWidth', 7).attr('markerHeight', 7)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-4L8,0L0,4Z')
        .attr('fill', '#888');

      const container = svgEl.append('g').attr('class', 'graph-container');

      // ── Draw edges ──
      const edgeGroup = container.append('g').attr('class', 'edges');
      for (const e of g.edges()) {
        const edgeData = g.edge(e);
        if (!edgeData || !edgeData.points) continue;
        const pts = edgeData.points;

        // Compute path
        const line = d3.line().x(p => p.x).y(p => p.y).curve(d3.curveBasis);
        const eg = edgeGroup.append('g').attr('class', 'edge');
        eg.append('path')
          .attr('d', line(pts))
          .attr('marker-end', 'url(#arrow)');
      }

      // ── Draw self-loops ──
      const selfLoops = data.edges.filter(e => e.source === e.target);
      for (const sl of selfLoops) {
        const nodeInfo = g.node(sl.source);
        if (!nodeInfo) continue;
        const cx = nodeInfo.x;
        const cy = nodeInfo.y - nodeInfo.height / 2;
        const r = 20;
        const eg = edgeGroup.append('g').attr('class', 'edge');
        eg.append('path')
          .attr('class', 'self-loop')
          .attr('d', 'M' + (cx - 10) + ',' + cy +
            ' C' + (cx - 10) + ',' + (cy - r * 2) +
            ' ' + (cx + 10) + ',' + (cy - r * 2) +
            ' ' + (cx + 10) + ',' + cy)
          .attr('marker-end', 'url(#arrow)');
      }

      // ── Draw nodes ──
      const nodeGroup = container.append('g').attr('class', 'nodes');
      const nodeMap = new Map();
      for (const n of data.nodes) nodeMap.set(n.id, n);

      for (const nid of g.nodes()) {
        const pos = g.node(nid);
        if (!pos) continue;
        const nd = nodeMap.get(nid);
        const isGroupedToken = (nid === '__tokens__');
        const isToken = isGroupedToken || (nd && nd.type === 'token');
        const isStart = nd && nd.id === data.startSymbol;
        const isRecursive = nd && nd.recursive;

        let cls = 'node ';
        if (isGroupedToken) cls += 'token';
        else if (isStart) cls += 'start';
        else if (isRecursive) cls += 'recursive';
        else if (isToken) cls += 'token';
        else cls += 'nonterminal';

        const ng = nodeGroup.append('g')
          .attr('class', cls)
          .attr('transform', 'translate(' + pos.x + ',' + pos.y + ')');

        const hw = pos.width / 2;
        const hh = pos.height / 2;

        if (isToken) {
          // Ellipse for terminals
          ng.append('ellipse')
            .attr('rx', hw).attr('ry', hh);
        } else {
          // Rounded rect for rules
          ng.append('rect')
            .attr('x', -hw).attr('y', -hh)
            .attr('width', pos.width).attr('height', pos.height)
            .attr('rx', 6).attr('ry', 6);
        }

        // Label
        if (mode === 'detailed' && nd && nd.alternatives && nd.alternatives.length > 0 && !isToken) {
          // Title at top
          ng.append('text')
            .attr('class', 'label')
            .attr('y', -hh + 16)
            .text(nd.id);
          // Alternatives
          for (let i = 0; i < nd.alternatives.length; i++) {
            const altText = nd.alternatives[i].join(' ');
            const display = altText.length > 30 ? altText.slice(0, 28) + '…' : altText;
            ng.append('text')
              .attr('class', 'alt-text')
              .attr('y', -hh + 34 + i * NODE_H_ALT_LINE)
              .text('→ ' + display);
          }
        } else {
          // Simple centered label
          const label = isGroupedToken ? pos.label : (nd ? nd.id : nid);
          ng.append('text')
            .attr('class', 'label')
            .text(label.length > 20 ? label.slice(0, 18) + '…' : label);
        }

        // Click → navigate
        if (nd) {
          ng.on('click', () => {
            vscode.postMessage({ command: 'navigateToRule', line: nd.line });
          });
        }

        // Hover → tooltip with First/Follow
        if (nd) {
          ng.on('mouseover', (event) => {
            let html = '<div class="tt-title">' + escHtml(nd.id) + '</div>';
            html += '<div>Line ' + (nd.line + 1) + ' · ' + nd.type + '</div>';
            if (nd.first && nd.first.length > 0) {
              html += '<div class="tt-section"><span class="tt-label">First:</span> ' +
                nd.first.map(s => '<code>' + escHtml(s) + '</code>').join(' ') + '</div>';
            }
            if (nd.follow && nd.follow.length > 0) {
              html += '<div class="tt-section"><span class="tt-label">Follow:</span> ' +
                nd.follow.map(s => '<code>' + escHtml(s) + '</code>').join(' ') + '</div>';
            }
            if (nd.recursive) {
              html += '<div class="tt-section" style="color:#e06060">⟲ Recursive (participates in a cycle)</div>';
            }
            tooltip.innerHTML = html;
            tooltip.style.display = 'block';
          });
          ng.on('mousemove', (event) => {
            tooltip.style.left = (event.clientX + 14) + 'px';
            tooltip.style.top = (event.clientY - 14) + 'px';
          });
          ng.on('mouseout', () => { tooltip.style.display = 'none'; });
        }
      }

      // ── Zoom ──
      const zoom = d3.zoom()
        .scaleExtent([0.1, 5])
        .on('zoom', (event) => {
          container.attr('transform', event.transform);
          updateMinimap(event.transform);
        });
      svgEl.call(zoom);

      // Center the graph initially
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const scale = Math.min(vw / gw, vh / gh, 1) * 0.9;
      const tx = (vw - gw * scale) / 2;
      const ty = (vh - gh * scale) / 2;
      const initialTransform = d3.zoomIdentity.translate(tx, ty).scale(scale);
      svgEl.call(zoom.transform, initialTransform);

      // ── Reset button ──
      document.getElementById('btn-reset').onclick = () => {
        svgEl.transition().duration(400).call(zoom.transform, initialTransform);
      };

      // ── Minimap ──
      renderMinimap(g, gw, gh);
      updateMinimap(initialTransform);

      // Store zoom ref for buttons
      window.__zoom = zoom;
      window.__svg = svgEl;
      window.__initialTransform = initialTransform;
    }

    // ── Minimap ──
    function renderMinimap(g, gw, gh) {
      const mmSvg = d3.select('#minimap svg');
      mmSvg.selectAll('*').remove();
      mmSvg.attr('viewBox', '0 0 ' + gw + ' ' + gh);

      const mmg = mmSvg.append('g');

      // Mini edges
      for (const e of g.edges()) {
        const edgeData = g.edge(e);
        if (!edgeData || !edgeData.points) continue;
        const line = d3.line().x(p => p.x).y(p => p.y).curve(d3.curveBasis);
        mmg.append('path')
          .attr('d', line(edgeData.points))
          .attr('fill', 'none').attr('stroke', '#555').attr('stroke-width', 1);
      }

      // Mini nodes
      const nodeMap = new Map();
      for (const n of data.nodes) nodeMap.set(n.id, n);
      for (const nid of g.nodes()) {
        const pos = g.node(nid);
        if (!pos) continue;
        const nd = nodeMap.get(nid);
        const isStart = nd && nd.id === data.startSymbol;
        const isRecursive = nd && nd.recursive;
        const isToken = (nid === '__tokens__') || (nd && nd.type === 'token');
        let color = '#2d8a4e';
        if (isStart) color = '#2b7bd6';
        else if (isRecursive) color = '#c04040';
        else if (isToken) color = '#555';
        mmg.append('rect')
          .attr('x', pos.x - pos.width / 2)
          .attr('y', pos.y - pos.height / 2)
          .attr('width', pos.width).attr('height', pos.height)
          .attr('rx', 3).attr('fill', color).attr('opacity', 0.7);
      }

      // Viewport rectangle
      mmSvg.append('rect')
        .attr('class', 'viewport-rect')
        .attr('x', 0).attr('y', 0)
        .attr('width', 100).attr('height', 100);
    }

    function updateMinimap(transform) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const mmRect = d3.select('#minimap .viewport-rect');
      if (mmRect.empty()) return;
      const inv = transform.invert([0, 0]);
      const inv2 = transform.invert([vw, vh]);
      mmRect
        .attr('x', inv[0]).attr('y', inv[1])
        .attr('width', inv2[0] - inv[0])
        .attr('height', inv2[1] - inv[1]);
    }

    // ── Export SVG ──
    function exportSVG() {
      const svgEl = document.getElementById('main-svg');
      const clone = svgEl.cloneNode(true);
      const container = clone.querySelector('.graph-container');
      if (container) container.removeAttribute('transform');
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(clone);
      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      downloadBlob(blob, 'grammar-graph.svg');
    }

    // ── Export PNG ──
    function exportPNG() {
      const svgEl = document.getElementById('main-svg');
      const clone = svgEl.cloneNode(true);
      const container = clone.querySelector('.graph-container');
      if (container) container.removeAttribute('transform');
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(clone);

      const canvas = document.createElement('canvas');
      const vb = svgEl.getAttribute('viewBox');
      const parts = vb ? vb.split(' ').map(Number) : [0, 0, 1200, 800];
      const scale = 2; // retina
      canvas.width = parts[2] * scale;
      canvas.height = parts[3] * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);

      const img = new Image();
      img.onload = () => {
        ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#1e1e1e';
        ctx.fillRect(0, 0, parts[2], parts[3]);
        ctx.drawImage(img, 0, 0, parts[2], parts[3]);
        canvas.toBlob(blob => {
          if (blob) downloadBlob(blob, 'grammar-graph.png');
        }, 'image/png');
      };
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function escHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Toolbar bindings ──
    document.getElementById('btn-compact').onclick = () => {
      document.getElementById('btn-compact').classList.add('active');
      document.getElementById('btn-detailed').classList.remove('active');
      render('compact');
    };
    document.getElementById('btn-detailed').onclick = () => {
      document.getElementById('btn-detailed').classList.add('active');
      document.getElementById('btn-compact').classList.remove('active');
      render('detailed');
    };
    document.getElementById('btn-svg').onclick = exportSVG;
    document.getElementById('btn-png').onclick = exportPNG;

    // ── Initial render ──
    render('compact');
  })();
  </script>
</body>
</html>`;
}
