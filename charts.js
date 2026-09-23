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
    width = Math.max(260, container.clientWidth || 360),
    height = 320,
    left = 42,
    top = 72,
    bottom = 280,
    step = (width - left - 20) / Math.max(s.rows.length, 1),
    labelEvery = Math.max(1, Math.ceil(s.rows.length / Math.max(2, (width - left) / 32))),
    y = (v) => bottom - ((v - min) / (max - min)) * (bottom - top),
    x = (i) => left + step * (i + 0.5);
  const svg = make("svg", {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: "img",
    "aria-label": t("chart"),
    xmlns: ns,
  });
  svg.append(make("rect", { width, height, fill: "white" }));
  svg.append(make("text", { x: 12, y: 23, "font-size": 14, fill: "#18343c" }, `${s.route.route} · ${s.date}`));
  for (const [i, field, color] of [[0, "boarding", "#16836b"], [1, "alighting", "#df8a31"], [2, "onboard", "#3152b5"]]) {
    const legendX = 12 + i * (width - 24) / 3;
    svg.append(make("rect", { x: legendX, y: 42, width: 9, height: 9, fill: color }));
    svg.append(make("text", { x: legendX + 13, y: 51, "font-size": 11, fill: "#18343c" }, t(field)));
  }
  svg.append(make("title", {}, t("chartLegend")));
  const tickSteps = Math.min(4, Math.max(1, max - min));
  const ticks = [...new Set(
    Array.from({ length: tickSteps + 1 }, (_, i) =>
      Math.round(min + ((max - min) * i) / tickSteps),
    ),
  )];
  for (const value of ticks) {
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
        value,
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
        r: Math.min(3, step / 4),
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
    if (i % labelEvery === 0 || i === s.rows.length - 1) svg.append(
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

export async function chartPng(container) {
  const svg = container.querySelector("svg");
  if (!svg) throw Error("Chart unavailable");
  const image = new Image();
  const xml = new XMLSerializer().serializeToString(svg);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(svg.viewBox.baseVal.width * 3);
  canvas.height = Math.ceil(svg.viewBox.baseVal.height * 3);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
