import { calculateOnboard } from "./survey.js";
export function renderChart(container, s, t, stopName) {
  const ns = "http://www.w3.org/2000/svg",
    make = (tag, attrs = {}, text) => {
      const el = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      if (text !== undefined) el.textContent = text;
      return el;
    };
  const values = calculateOnboard(s).values,
    all = [
      0,
      ...values.filter((x) => x !== null),
      ...s.rows.flatMap((r) => [
        Number(r.boarding) || 0,
        Number(r.alighting) || 0,
      ]),
    ],
    min = Math.min(...all),
    max = Math.max(1, ...all),
    width = Math.max(360, s.rows.length * 44 + 70),
    height = 280,
    left = 42,
    top = 20,
    bottom = 230,
    step = (width - left - 20) / Math.max(s.rows.length, 1),
    y = (v) => bottom - ((v - min) / (max - min)) * (bottom - top),
    x = (i) => left + step * (i + 0.5);
  const svg = make("svg", {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: "img",
    "aria-label": t("chart"),
  });
  svg.append(make("title", {}, t("chartLegend")));
  for (let i = 0; i <= 4; i++) {
    const value = min + ((max - min) * i) / 4;
    svg.append(
      make("line", {
        x1: left,
        y1: y(value),
        x2: width - 10,
        y2: y(value),
        stroke: "#d5dedb",
      }),
      make(
        "text",
        {
          x: left - 6,
          y: y(value) + 4,
          "text-anchor": "end",
          "font-size": 11,
          fill: "#526b70",
        },
        Number.isInteger(value) ? value : value.toFixed(1),
      ),
    );
  }
  let path = "",
    continuing = false;
  s.rows.forEach((r, i) => {
    for (const [field, offset, color] of [
      ["boarding", -0.23, "#16836b"],
      ["alighting", 0.02, "#df8a31"],
    ])
      if (r[field] !== "") {
        const value = Number(r[field]);
        const bar = make("rect", {
          x: x(i) + step * offset,
          y: y(value),
          width: step * 0.21,
          height: Math.max(0, y(0) - y(value)),
          fill: color,
          "data-series": field,
          "data-stop": i,
        });
        bar.append(
          make(
            "title",
            {},
            `${i + 1}. ${stopName(s.stops[i])}: ${t(field)} ${value}`,
          ),
        );
        svg.append(bar);
      }
    const value = values[i];
    if (value === null) {
      continuing = false;
    } else {
      path += `${continuing ? "L" : "M"}${x(i)},${y(value)} `;
      continuing = true;
      const point = make("circle", {
        cx: x(i),
        cy: y(value),
        r: 3,
        fill: "#3152b5",
        "data-series": "onboard",
        "data-stop": i,
      });
      point.append(
        make(
          "title",
          {},
          `${i + 1}. ${stopName(s.stops[i])}: ${t("onboard")} ${value}`,
        ),
      );
      svg.append(point);
    }
    svg.append(
      make(
        "text",
        {
          x: x(i),
          y: bottom + 20,
          "text-anchor": "middle",
          "font-size": 11,
          fill: "#18343c",
        },
        i + 1,
      ),
    );
  });
  svg.append(
    make("path", {
      d: path,
      fill: "none",
      stroke: "#3152b5",
      "stroke-width": 2,
      "data-series": "onboard-line",
    }),
  );
  container.replaceChildren(svg);
}
