document.addEventListener("DOMContentLoaded", function () {
  const rawData = document.getElementById("pendingWorkOrdersData").textContent;
  const pendingWorkOrders = JSON.parse(rawData);

  const labels = pendingWorkOrders.map((order) => order._id);
  const cmTotalCosts = pendingWorkOrders.map((order) => order.cmTotalCost);
  const pmTotalCosts = pendingWorkOrders.map((order) => order.pmTotalCost);
  const cmPendingCounts = pendingWorkOrders.map((order) => order.cmPendingCount);
  const pmPendingCounts = pendingWorkOrders.map((order) => order.pmPendingCount);

  // รวมข้อมูลทั้งหมดเพื่อใช้ในการหาค่าสูงสุด
  const allCosts = cmTotalCosts.concat(pmTotalCosts);
  const maxCost = Math.max(...allCosts);
  const roundedMax = Math.ceil(maxCost / 5000) * 5000; // ปัดขึ้นใกล้สุดเพื่อใช้เป็น max

  // ฟังก์ชันคำนวณขนาดตัวอักษรตามขนาดหน้าจอ
  function getResponsiveFontSize() {
    if (window.innerWidth < 768) return 9; // หน้าจอเล็ก (มือถือ)
    if (window.innerWidth < 1024) return 12; // หน้าจอขนาดกลาง (แท็บเล็ต)
    return 15; // หน้าจอใหญ่ (เดสก์ท็อป)
  }

  const ctx = document.getElementById("pendingWorkChart").getContext("2d");
  const chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Total Pending Cost (CM)",
          data: cmTotalCosts,
          backgroundColor: "rgba(173, 216, 230, 0.5)",
          borderColor: "rgba(173, 216, 230, 1)",
          borderWidth: 1,
          datalabels: {
            display: (context) => context.dataset.data[context.dataIndex] > 0,
            labels: {
              title: {
                anchor: "start",
                align: "center",
                color: "black",
                font: () => ({
                  family: "kanit",
                  weight: "normal",
                  size: getResponsiveFontSize()-1,
                }),
                formatter: (value, context) => `${cmPendingCounts[context.dataIndex]} Jobs`,
              },
              value: {
                anchor: "end",
                align: "top",
                color: "black",
                font: () => ({
                  family: "kanit",
                  weight: "bold",
                  size: getResponsiveFontSize(),
                }),
                formatter: (value) =>
                  `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                padding: 10,
              },
            },
          },
        },
        {
          label: "Total Pending Cost (PM)",
          data: pmTotalCosts,
          backgroundColor: "rgba(144, 238, 144, 0.5)",
          borderColor: "rgba(144, 238, 144, 1)",
          borderWidth: 1,
          datalabels: {
            display: (context) => context.dataset.data[context.dataIndex] > 0,
            labels: {
              title: {
                anchor: "start",
                align: "center",
                color: "black",
                font: () => ({
                  family: "kanit",
                  weight: "normal",
                  size: getResponsiveFontSize()-1,
                }),
                formatter: (value, context) => `${pmPendingCounts[context.dataIndex]}Jobs`,
              },
              value: {
                anchor: "end",
                align: "top",
                color: "black",
                font: () => ({
                  family: "kanit",
                  weight: "bold",
                  size: getResponsiveFontSize(),
                }),
                formatter: (value) =>
                  `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                padding: 10,
              },
            },
          },
        },
      ],
    },
    options: {
      responsive: true,
      layout: {
        padding: {
          top: 40,     // ✅ เพิ่ม padding ด้านบนเพื่อไม่ให้ label โดนตัด
          bottom: 20,  // ✅ เผื่อพื้นที่ด้านล่างสำหรับ legend
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: roundedMax, // กำหนด max ตามค่าที่คำนวณได้
          ticks: {
            stepSize: 5000,
            precision: 0,
            font: () => ({
              size: getResponsiveFontSize(),
            }),
          },
        },
        x: {
          barPercentage: 0.6,
          categoryPercentage: 0.8,
          ticks: {
            font: () => ({
              size: getResponsiveFontSize(),
            }),
          },
        },
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            font: () => ({
              family: "kanit",
              weight: "bold",
              size: getResponsiveFontSize(),
            }),
          },
        },
      },
    },
    plugins: [ChartDataLabels],
  });

  // อัปเดต font size ทุกครั้งที่ resize
  window.addEventListener("resize", function () {
    chart.options.scales.y.ticks.font.size = getResponsiveFontSize();
    chart.options.scales.x.ticks.font.size = getResponsiveFontSize();
    chart.options.plugins.legend.labels.font.size = getResponsiveFontSize();
  
    chart.data.datasets.forEach((dataset) => {
      dataset.datalabels.labels.title.font.size = getResponsiveFontSize();
      dataset.datalabels.labels.value.font.size = getResponsiveFontSize();
    });
  
    chart.resize(); // ✅ ปรับขนาด chart ตาม container
    chart.update(); // ✅ อัปเดตข้อมูล/ฟอนต์
  });
  
});