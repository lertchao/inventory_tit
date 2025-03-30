document.addEventListener("DOMContentLoaded", () => {
    const table = document.querySelector("table");
    const header = table.querySelector('th[data-column="createdAt"]'); // เฉพาะหัวคอลัมน์ Created At
    const tbody = table.querySelector("tbody");
    const icon = header.querySelector("i");
  
    header.addEventListener("click", () => {
      const sortOrder = header.getAttribute("data-sort-order");
      const rows = Array.from(tbody.querySelectorAll("tr"));
  
      // จัดเรียงแถวตามวันที่และเวลาในฐานข้อมูล
      const sortedRows = rows.sort((a, b) => {
        const cellA = a.querySelector(`td:nth-child(${header.cellIndex + 1})`).getAttribute("data-datetime");
        const cellB = b.querySelector(`td:nth-child(${header.cellIndex + 1})`).getAttribute("data-datetime");
  
        return sortOrder === "asc"
          ? new Date(cellA) - new Date(cellB)
          : new Date(cellB) - new Date(cellA);
      });
  
      // อัปเดตลำดับการเรียง
      header.setAttribute("data-sort-order", sortOrder === "asc" ? "desc" : "asc");
  
      // อัปเดตไอคอน
      icon.className = sortOrder === "asc" ? "fa fa-sort-up" : "fa fa-sort-down";
  
      // เพิ่มแถวเรียงใหม่ใน tbody
      tbody.innerHTML = "";
      sortedRows.forEach(row => tbody.appendChild(row));
    });
  });