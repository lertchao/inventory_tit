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




// document.addEventListener("DOMContentLoaded", function () {
//   const rawData = document.getElementById("pendingWorkOrdersData").textContent;
//   const pendingWorkOrders = JSON.parse(rawData);

//   const labels = pendingWorkOrders.map((order) => order._id);
//   const cmTotalCosts = pendingWorkOrders.map((order) => order.cmTotalCost);
//   const pmTotalCosts = pendingWorkOrders.map((order) => order.pmTotalCost);
//   const cmPendingCounts = pendingWorkOrders.map((order) => order.cmPendingCount);
//   const pmPendingCounts = pendingWorkOrders.map((order) => order.pmPendingCount);

//   // รวมข้อมูลทั้งหมดเพื่อใช้ในการหาค่าสูงสุด
//   const allCosts = cmTotalCosts.concat(pmTotalCosts);
//   const maxCost = Math.max(...allCosts);
//   const roundedMax = Math.ceil(maxCost / 5000) * 5000; // ปัดขึ้นใกล้สุดเพื่อใช้เป็น max

//   // ฟังก์ชันคำนวณขนาดตัวอักษรตามขนาดหน้าจอ
//   function getResponsiveFontSize() {
//     if (window.innerWidth < 768) return 9; // หน้าจอเล็ก (มือถือ)
//     if (window.innerWidth < 1024) return 12; // หน้าจอขนาดกลาง (แท็บเล็ต)
//     return 15; // หน้าจอใหญ่ (เดสก์ท็อป)
//   }

//   const ctx = document.getElementById("pendingWorkChart").getContext("2d");
//   const chart = new Chart(ctx, {
//     type: "bar",
//     data: {
//       labels: labels,
//       datasets: [
//         {
//           label: "Total Pending Cost (CM)",
//           data: cmTotalCosts,
//           backgroundColor: "rgba(173, 216, 230, 0.5)",
//           borderColor: "rgba(173, 216, 230, 1)",
//           borderWidth: 1,
//           datalabels: {
//             display: (context) => context.dataset.data[context.dataIndex] > 0,
//             labels: {
//               title: {
//                 anchor: "start",
//                 align: "center",
//                 color: "black",
//                 font: () => ({
//                   family: "kanit",
//                   weight: "normal",
//                   size: getResponsiveFontSize()-2,
//                 }),
//                 formatter: (value, context) => ${cmPendingCounts[context.dataIndex]} Rp.,
//               },
//               value: {
//                 anchor: "end",
//                 align: "top",
//                 color: "black",
//                 font: () => ({
//                   family: "kanit",
//                   weight: "normal",
//                   size: getResponsiveFontSize(),
//                 }),
//                 formatter: (value) =>
//                   ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })},
//                 padding: 10,
//               },
//             },
//           },
//         },
//         {
//           label: "Total Pending Cost (PM)",
//           data: pmTotalCosts,
//           backgroundColor: "rgba(144, 238, 144, 0.5)",
//           borderColor: "rgba(144, 238, 144, 1)",
//           borderWidth: 1,
//           datalabels: {
//             display: (context) => context.dataset.data[context.dataIndex] > 0,
//             labels: {
//               title: {
//                 anchor: "start",
//                 align: "center",
//                 color: "black",
//                 font: () => ({
//                   family: "kanit",
//                   weight: "normal",
//                   size: getResponsiveFontSize()-2,
//                 }),
//                 formatter: (value, context) => ${pmPendingCounts[context.dataIndex]} Rp.,
//               },
//               value: {
//                 anchor: "end",
//                 align: "top",
//                 color: "black",
//                 font: () => ({
//                   family: "kanit",
//                   weight: "normal",
//                   size: getResponsiveFontSize(),
//                 }),
//                 formatter: (value) =>
//                   ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })},
//                 padding: 10,
//               },
//             },
//           },
//         },
//       ],
//     },
//     options: {
//       responsive: true,
//       layout: {
//         padding: {
//           top: 40,     // ✅ เพิ่ม padding ด้านบนเพื่อไม่ให้ label โดนตัด
//           bottom: 20,  // ✅ เผื่อพื้นที่ด้านล่างสำหรับ legend
//         },
//       },
//       scales: {
//         y: {
//           beginAtZero: true,
//           max: roundedMax, // กำหนด max ตามค่าที่คำนวณได้
//           ticks: {
//             stepSize: 20000,
//             precision: 0,
//             font: () => ({
//               size: getResponsiveFontSize(),
//             }),
//           },
//         },
//         x: {
//           barPercentage: 0.6,
//           categoryPercentage: 0.8,
//           ticks: {
//             font: () => ({
//               size: getResponsiveFontSize(),
//             }),
//           },
//         },
//       },
//       plugins: {
//         legend: {
//           position: "bottom",
//           labels: {
//             font: () => ({
//               family: "kanit",
//               weight: "bold",
//               size: getResponsiveFontSize(),
//             }),
//           },
//         },
//       },
//     },
//     plugins: [ChartDataLabels],
//   });

//   // อัปเดต font size ทุกครั้งที่ resize
//   window.addEventListener("resize", function () {
//     chart.options.scales.y.ticks.font.size = getResponsiveFontSize();
//     chart.options.scales.x.ticks.font.size = getResponsiveFontSize();
//     chart.options.plugins.legend.labels.font.size = getResponsiveFontSize();
  
//     chart.data.datasets.forEach((dataset) => {
//       dataset.datalabels.labels.title.font.size = getResponsiveFontSize();
//       dataset.datalabels.labels.value.font.size = getResponsiveFontSize();
//     });
  
//     chart.resize(); // ✅ ปรับขนาด chart ตาม container
//     chart.update(); // ✅ อัปเดตข้อมูล/ฟอนต์
//   });
  
// });