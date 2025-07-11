document.addEventListener("DOMContentLoaded", () => {
  const raw = document.getElementById("pendingWorkOrdersData").textContent;
  const src = JSON.parse(raw);
  const labels           = src.map(o => o._id);
  const cmTotals         = src.map(o => o.cmTotalCost);
  const pmTotals         = src.map(o => o.pmTotalCost);
  const cmJobs           = src.map(o => o.cmPendingCount);
  const pmJobs           = src.map(o => o.pmPendingCount);

  const max  = Math.max(...cmTotals, ...pmTotals);
  const yMax = Math.ceil(max / 5000) * 5000;

  const fSize = () =>
    window.innerWidth <  768 ? 9 :
    window.innerWidth < 1024 ? 12 : 15;

  const makeLabels = (jobsArr) => ({
    labels : {
      title : {
        display : (ctx) => jobsArr[ctx.dataIndex] > 0,  
        anchor  : "start",
        align   : "center",
        color   : "black",
        font    : () => ({ family:"kanit", weight:"normal", size:fSize()-2 }),
        formatter : (v,ctx) => `${jobsArr[ctx.dataIndex]} Rp.`
      },
      value : {
        display : (ctx) => ctx.dataset.data[ctx.dataIndex] >= 10000,
        anchor  : "end",
        align   : "top",
        color   : "black",
        font    : () => ({ family:"kanit", weight:"normal", size:fSize() }),
        padding : 10,
        formatter : (v) => v.toLocaleString(undefined,{
          minimumFractionDigits:2, maximumFractionDigits:2
        })
      }
    }
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
          backgroundColor : "rgba(173,216,230,0.5)",
          borderColor     : "rgba(173,216,230,1)",
          borderWidth     : 1,
          datalabels      : makeLabels(cmJobs)
        },
        {
          label : "Total Pending Cost (PM)",
          data  : pmTotals,
          backgroundColor : "rgba(144,238,144,0.5)",
          borderColor     : "rgba(144,238,144,1)",
          borderWidth     : 1,
          datalabels      : makeLabels(pmJobs)
        }
      ]
    },

    options : {
      responsive : true,
      layout : { padding:{ top:40, bottom:20 } },

      scales : {
        y : {
          beginAtZero:true,
          max:yMax,
          ticks:{
            stepSize:20000,
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
        tooltip : { mode:"index", intersect:false },
        legend  : {
          position:"bottom",
          labels:{
            font:()=>({ family:"kanit", weight:"bold", size:fSize() })
          }
        }
      }
    },

    plugins : [ChartDataLabels]
  });

  window.addEventListener("resize", () => {
    const s = fSize();
    chart.options.scales.x.ticks.font.size        = s;
    chart.options.scales.y.ticks.font.size        = s;
    chart.options.plugins.legend.labels.font.size = s;

    chart.data.datasets.forEach(ds => {
      const {title,value} = ds.datalabels.labels;
      title.font.size  = s - 2;
      value.font.size  = s;
    });

    chart.resize(); chart.update();
  });
});


