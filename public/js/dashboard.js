document.addEventListener("DOMContentLoaded", () => {
  Chart.defaults.font.family = 'Lato, "Noto Sans Thai", sans-serif';
  const raw = document.getElementById("pendingWorkOrdersData").textContent;
const allData = JSON.parse(raw);

// ใส่ชื่อที่ไม่ต้องการให้แสดงบนกราฟ
const hiddenRequesters = ["Peet", "Lert",];

const src = allData.filter(o => {
  const requesterName = String(o._id || "").trim();
  return !hiddenRequesters.includes(requesterName);
});

const labels           = src.map(o => o._id);
  const cmTotals         = src.map(o => o.cmTotalCost);
  const pmTotals         = src.map(o => o.pmTotalCost);
  const cmJobs           = src.map(o => o.cmPendingCount);
  const pmJobs           = src.map(o => o.pmPendingCount);

  const max  = Math.max(...cmTotals, ...pmTotals);
  const yMax = Math.ceil(max / 20000) * 20000;

  const fSize = () =>
    window.innerWidth <  768 ? 9 :
    window.innerWidth < 1024 ? 12 : 15;

  const makeLabels = () => ({
    display : (ctx) => window.innerWidth >= 768 && ctx.dataset.data[ctx.dataIndex] > 0,
    anchor  : "end",
    align   : "top",
    color   : "#374151",
    font    : () => ({ weight:"normal", size:fSize() }),
    padding : 6,
    formatter : (v) => new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1
    }).format(v)
  });

  const ctx = document.getElementById("pendingWorkChart").getContext("2d");
  const chart = new Chart(ctx, {
    type : "bar",
    data : {
      labels,
      datasets : [
        {
          label : "Total Pending Cost (CM)",
          data  : cmTotals,
          backgroundColor : "rgba(59,130,246,0.7)",
          borderColor     : "rgba(37,99,235,1)",
          borderWidth     : 1,
          borderRadius    : 2,
          datalabels      : makeLabels()
        },
        {
          label : "Total Pending Cost (PM)",
          data  : pmTotals,
          backgroundColor : "rgba(16,185,129,0.7)",
          borderColor     : "rgba(5,150,105,1)",
          borderWidth     : 1,
          borderRadius    : 2,
          datalabels      : makeLabels()
        }
      ]
    },

    options : {
      responsive : true,
      maintainAspectRatio : false,
      layout : { padding:{ top:40, bottom:20 } },

      scales : {
        y : {
          beginAtZero:true,
          max:yMax,
          grid: { color: "rgba(0,0,0,0.05)" },
          ticks:{
            font:()=>({ size:fSize() })
          }
        },
        x : {
          barPercentage:0.6,
          categoryPercentage:0.8,
          ticks:{ font:()=>({ size:fSize() }) }
        }
      },

      plugins : {
        tooltip : {
          mode:"index",
          intersect:false,
          callbacks: {
            label: (ctx) => {
              const idx = ctx.dataIndex;
              const isCm = ctx.datasetIndex === 0;
              const jobs = isCm ? cmJobs[idx] : pmJobs[idx];
              const val  = new Intl.NumberFormat("en", { minimumFractionDigits:0, maximumFractionDigits:0 }).format(ctx.raw);
              return ` ${ctx.dataset.label}: ฿${val}  (${jobs} Rp.)`;
            }
          }
        },
        legend  : {
          position:"bottom",
          labels:{
            font:()=>({ family:"Lato", weight:"bold", size:fSize() })
          }
        }
      }
    },

    plugins : [ChartDataLabels]
  });

  window.addEventListener("resize", () => {
    chart.resize(); chart.update();
  });
});


