// pending.js  (single-bar version: combine CM+PM)
document.addEventListener("DOMContentLoaded", () => {
  const raw = document.getElementById("pendingWorkOrdersData").textContent;
  const src = JSON.parse(raw) || [];

  // ใช้ requesterName เป็น label (_id คือ requesterName จาก pipeline)
  const labels = src.map(o => o._id);

  // รวมมูลค่า CM+PM เป็นแท่งเดียว
  const totalsCombined = src.map(
    o => (o.cmTotalCost || 0) + (o.pmTotalCost || 0)
  );

  // ✅ ใช้จำนวนใบงานแบบนับ requestId ไม่ซ้ำ ต่อ requester (backend คำนวณแล้ว)
  const pendingJobs = src.map(o => Number(o.pendingJobs || 0));

  // สเกลแกน Y
  const max  = totalsCombined.length ? Math.max(...totalsCombined) : 0;
  const step = 20000; // ปรับได้ตามเหมาะสม
  const yMax = Math.max(step, Math.ceil(max / step) * step);

  const fSize = () =>
    window.innerWidth <  768 ? 9 :
    window.innerWidth < 1024 ? 12 : 15;

  // datalabels: แสดงมูลค่าแบบ compact + เว้นวรรคก่อนหน่วย (เช่น 96.1 K)
  const makeLabels = () => ({
    labels: {
      value: {
        display: true,
        anchor: "end",
        align: "top",
        offset: 8,
        clamp: true,
        color: "#333",
        font: () => ({ family: "kanit", weight: "normal", size: fSize() }),
        formatter: (v) =>
          new Intl.NumberFormat("en", {
            notation: "compact",
            maximumFractionDigits: 1
          })
          .format(v)
          .replace(/([A-Za-z])/g, "$1") 
      }
    }
  });

  const ctx = document.getElementById("pendingWorkChart").getContext("2d");
  const chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Total Pending Cost",
          data: totalsCombined,
          backgroundColor: "rgba(242, 182, 107, 0.4)",
          borderColor: "rgba(230, 162, 60, 0.9)",
          borderWidth: 1,
          datalabels: makeLabels()
        }
      ]
    },
    options: {
      responsive: true,
      layout: { padding: { top: 40, bottom: 20 } },
      scales: {
        y: {
          beginAtZero: true,
          max: yMax,
          ticks: {
            stepSize: step,
            font: () => ({ size: fSize() })
          }
        },
        x: {
          barPercentage: 0.6,
          categoryPercentage: 0.8,
          ticks: { font: () => ({ size: fSize() }) }
        }
      },
      plugins: {
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y || 0;
              const full = v.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              });
              return ` Total: ${full}`;
            },
            afterLabel: (ctx) => {
              const i = ctx.dataIndex;
              const jobs = pendingJobs[i] || 0;
              return jobs > 0 ? `\n${jobs} Repair` : "";
            }
          }
        },
        legend: {
          position: "bottom",
          labels: {
            font: () => ({ family: "kanit", weight: "bold", size: fSize() })
          }
        }
      }
    },
    plugins: [ChartDataLabels]
  });

  // ปรับขนาด label ตามหน้าจอเมื่อ resize (เฉพาะ value)
  window.addEventListener("resize", () => {
    const s = fSize();
    chart.options.scales.x.ticks.font.size = s;
    chart.options.scales.y.ticks.font.size = s;
    chart.options.plugins.legend.labels.font.size = s;

    const dl = chart.data.datasets[0]?.datalabels?.labels;
    if (dl?.value?.font) dl.value.font.size = s;

    chart.resize();
    chart.update();
  });
});
