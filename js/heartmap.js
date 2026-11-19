// “五心”缩略图
//
// 侧栏那五个按钮只能让三维场景里的楼淡出，看的人是站在楼群里的，
// 不一定意识到“匠心”这一维铺开是多大一片、落在哪一侧。
// 这张小图把整座校园压成俯视轮廓，点哪一心，那几栋楼就在图上亮起来，
// 跟大场景里高亮的是同一批楼——一个看分布，一个看体量。

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs) {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

function polyPoints(part) {
  return part.map(([x, z]) => `${x},${z}`).join(' ');
}

/**
 * @param {HTMLElement} host   放图的容器
 * @param {Array} buildings    plan.js 的 BUILDINGS
 * @param {Object} site        plan.js 的 SITE
 * @param {Object} extras      { lake, track } 可选的湖与跑道轮廓
 * @param {Function} onPick    点某栋楼时回调，参数是 building
 * @returns {{ highlight: Function }}
 */
export function initHeartMap(host, buildings, site, extras, onPick) {
  const { lake, track, roads } = extras || {};
  const pad = 14;
  const bw = site.x2 - site.x1;
  const bh = site.z2 - site.z1;
  // 直接用世界坐标当 viewBox，省掉一层换算；描边用 non-scaling-stroke 保持 1px
  const svg = el('svg', {
    viewBox: `${site.x1 - pad} ${site.z1 - pad} ${bw + pad * 2} ${bh + pad * 2}`,
    preserveAspectRatio: 'xMidYMid meet',
    class: 'hmap',
  });

  // 底板：白面板上再加一层浅灰，楼才显得出来
  svg.appendChild(el('rect', {
    x: site.x1 - pad, y: site.z1 - pad,
    width: bw + pad * 2, height: bh + pad * 2,
    class: 'hmap-bg',
  }));

  // 路网：细灰线，帮人把缩略图和大场景对起来。
  // viewBox 直接用世界坐标，所以 stroke-width 写米数就是实际路宽
  if (roads) {
    roads.forEach(r => {
      svg.appendChild(el('line', {
        x1: r.x1, y1: r.z1, x2: r.x2, y2: r.z2,
        class: 'hmap-road',
        'stroke-width': r.w * 0.8,
      }));
    });
  }

  // 湖：压在最底下当底图，让人分得清东西两岸
  if (lake && lake.length > 2) {
    svg.appendChild(el('polygon', {
      points: polyPoints(lake),
      class: 'hmap-lake',
      'vector-effect': 'non-scaling-stroke',
    }));
  }
  // 跑道：一个胶囊，画成跑道内缘的圆角矩形即可
  if (track) {
    const x0 = track.x - track.R - track.halfL;
    const y0 = track.z - track.R;
    svg.appendChild(el('rect', {
      x: x0, y: y0,
      width: track.R * 2 + track.halfL * 2,
      height: track.R * 2,
      rx: track.R,
      class: 'hmap-track',
      'vector-effect': 'non-scaling-stroke',
    }));
  }

  const nodes = [];
  buildings.forEach(b => {
    const parts = (b.parts && b.parts.length) ? b.parts : [b.poly];
    parts.forEach(pt => {
      if (!pt || pt.length < 3) return;
      const shape = el('polygon', {
        points: polyPoints(pt),
        class: 'hmap-b',
        'vector-effect': 'non-scaling-stroke',
        'data-id': b.id,
      });
      shape.appendChild(Object.assign(document.createElementNS(NS, 'title'), { textContent: b.name }));
      shape.addEventListener('click', () => { if (onPick) onPick(b); });
      svg.appendChild(shape);
      nodes.push(shape);
    });
  });

  const head = document.createElement('div');
  head.className = 'hmap-title';
  head.innerHTML = '<span>“五心”落点 · 点击楼栋看详情</span>'
    + '<button id="hmap-close" title="收起缩略图">×</button>';
  host.appendChild(head);
  host.appendChild(svg);
  const cap = document.createElement('div');
  cap.className = 'hmap-cap';
  cap.innerHTML = '<span>总平面 · 约 787 × 422 米</span><span id="hmap-count"></span>';
  host.appendChild(cap);

  function highlight(heart) {
    const set = heart ? new Set(heart.buildings) : null;
    nodes.forEach(n => {
      const on = set ? set.has(n.getAttribute('data-id')) : true;
      n.classList.toggle('on', !!on);
      n.classList.toggle('dim', !!set && !on);
      n.style.fill = (set && on) ? heart.color : '';
    });
    svg.classList.toggle('has-heart', !!heart);
    const cnt = document.getElementById('hmap-count');
    if (cnt) cnt.innerHTML = heart
      ? `<b>${heart.name}${heart.word}</b> · ${heart.buildings.length} 栋`
      : '';
  }

  return { highlight };
}
