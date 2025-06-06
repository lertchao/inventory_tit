document.addEventListener("DOMContentLoaded", function () {
  // ฟังก์ชันสำหรับอัปเดตการแสดงปุ่มลบ
  function updateRemoveButtons() {
    const rows = document.querySelectorAll("table tbody tr");
    const removeButtons = document.querySelectorAll(".remove-row");

    if (rows.length > 1) {
      removeButtons.forEach(
        (button) => (button.style.display = "inline-block")
      ); // แสดงปุ่มลบ
    } else {
      removeButtons.forEach((button) => (button.style.display = "none")); // ซ่อนปุ่มลบ
    }
  }

  // เมื่อผู้ใช้กรอก SKU
  document.addEventListener("input", function (event) {
    if (event.target.classList.contains("sku-input")) {
      const sku = event.target.value.trim();
      const row = event.target.closest("tr");
      const descriptionCell = row.querySelector(".description-cell");
      const costCell = row.querySelector(".cost-cell");

      if (sku) {
        fetch(`/get-product-details?sku=${sku}`)
          .then((response) => response.json())
          .then((data) => {
            if (data && data.product) {
              // อัปเดตข้อมูลเมื่อพบสินค้า
              descriptionCell.textContent =
                data.product.description || "ไม่พบข้อมูล";
              descriptionCell.classList.remove("text-danger"); // ลบคลาสสีแดงถ้าเจอสินค้า
              descriptionCell.classList.add("text-dark"); // เพิ่มสีปกติ
              costCell.classList.remove("text-danger"); // ลบคลาสสีแดงถ้าเจอสินค้า
              costCell.classList.add("text-dark"); // เพิ่มสีปกติ
              costCell.textContent =
                new Intl.NumberFormat().format(data.product.cost) ||
                "ไม่พบข้อมูล";
            } else {
              // แสดงข้อความสีแดงเมื่อไม่พบสินค้า
              descriptionCell.textContent = "ไม่พบข้อมูล SKU";
              descriptionCell.classList.remove("text-dark"); // ลบคลาสสีปกติ
              descriptionCell.classList.add("text-danger"); // เพิ่มสีแดง
              costCell.textContent = "ไม่พบข้อมูล";
              costCell.classList.remove("text-dark"); // ลบคลาสสีปกติ
              costCell.classList.add("text-danger"); // เพิ่มสีแดง
            }
          })
          .catch((error) => {
            console.error("Error fetching product details:", error);
            descriptionCell.textContent = "เกิดข้อผิดพลาด";
            descriptionCell.classList.add("text-danger"); // เพิ่มสีแดง
            costCell.textContent = "เกิดข้อผิดพลาด";
          });
      } else {
        // รีเซ็ตข้อความเมื่อไม่มีการกรอก SKU
        descriptionCell.textContent = "";
        descriptionCell.classList.remove("text-danger", "text-dark"); // ลบคลาสสีแดงและปกติ
        costCell.textContent = "";
      }
    }
  });

  // ค้นหาชื่อสาขาจาก storeId
  const storeIdInput = document.getElementById("storeId");
  const storenameInput = document.getElementById("storename");

  storeIdInput.addEventListener("input", async function () {
    const storeId = storeIdInput.value.trim();
    storenameInput.value = ""; // เคลียร์ค่าก่อน

    if (!storeId) {
      storenameInput.classList.remove("text-danger");
      return;
    }

    try {
      const response = await fetch(`/get-store-name?storeId=${storeId}`);
      const data = await response.json();

      if (response.ok && data.storename) {
        storenameInput.value = data.storename;
        storenameInput.classList.remove("text-danger"); // ลบ text-danger เมื่อพบข้อมูล
      } else {
        storenameInput.value = "ไม่พบข้อมูล";
        storenameInput.classList.add("text-danger");
      }
    } catch (error) {
      console.error("Error fetching store name:", error);
      storenameInput.value = "เกิดข้อผิดพลาด";
      storenameInput.classList.add("text-danger");
    }
  });

  // เพิ่มแถว
  document.querySelector(".add-row").addEventListener("click", function () {
    const tableBody = document.querySelector("table tbody");
    const newRow = `
      <tr>
        <td>
          <input type="text" class="form-control sku-input" placeholder="กรอกรหัสสินค้า" name="sku" required>
        </td>
        <td class="text-center description-cell"></td>
        <td>
          <input type="number" class="form-control text-center" placeholder="กรอกจำนวน" name="quantity" value="1" required>
        </td>
        <td class="text-center cost-cell"></td>
        <td class="text-center">
          <button type="button" class="btn btn-danger btn-sm remove-row">ลบ</button>
        </td>
      </tr>
    `;
    tableBody.insertAdjacentHTML("beforeend", newRow);
    updateRemoveButtons(); // อัปเดตปุ่มลบ
  });

  // ลบแถว
  document.addEventListener("click", function (event) {
    if (event.target.classList.contains("remove-row")) {
      const row = event.target.closest("tr");
      row.remove();
      updateRemoveButtons(); // อัปเดตปุ่มลบ
    }
  });

  // อัปเดตปุ่มลบในตอนโหลดหน้าเว็บ
  updateRemoveButtons();

  // ฟังก์ชันตรวจสอบเลขที่ใบเบิกและกรอกข้อมูลอัตโนมัติ
  const repairInput = document.querySelector('[name="repair"]');
  const nameInput = document.querySelector('[name="name"]');
  const workStatusInput = document.querySelector('[name="workStatus"]');
  const storeIdInputField = document.querySelector('[name="storeId"]');
  const storenameInputField = document.getElementById("storename");

  repairInput.addEventListener("input", async function () {
    const repair = repairInput.value.trim();

    if (!repair) {
      // ถ้าไม่มีการกรอกเลขที่ใบเบิก ให้เคลียร์ข้อมูล
      nameInput.value = "";
      workStatusInput.value = "Pending";
      storeIdInputField.value = "";
      storenameInputField.value = "";
      repairHistorySection.classList.add("d-none");
      return;
    }

    try {
      const response = await fetch(`/get-transaction-details?repair=${repair}`);
      const data = await response.json();

      if (response.ok && data.transaction) {
        // หากพบข้อมูล transaction ในฐานข้อมูล
        nameInput.value = data.transaction.requesterName;
        workStatusInput.value = data.transaction.workStatus || "Pending";
        storeIdInputField.value = data.transaction.storeId;
        storenameInputField.value = data.transaction.storeName || ""; // ถ้า storeName มีค่า ให้แสดง

        // เรียกใช้งานฟังก์ชันค้นหาชื่อสาขาหลังจากกรอก storeId
        storeIdInputField.dispatchEvent(new Event("input"));
      } else {
        // หากไม่พบข้อมูล ให้ปล่อยให้ฟอร์มเป็นค่าว่าง
        nameInput.value = "";
        workStatusInput.value = "Pending";
        storeIdInputField.value = "";
        storenameInputField.value = "";
      }

      await loadRepairHistory(repair);
      
    } catch (error) {
      console.error("Error fetching transaction details:", error);
      // ถ้าเกิดข้อผิดพลาด ให้เคลียร์ค่าหรือแสดงข้อความผิดพลาด
      nameInput.value = "";
      workStatusInput.value = "";
      storeIdInputField.value = "";
      storenameInputField.value = "";
      repairHistorySection.classList.add("d-none");
    }
  });

  // โหลดข้อมูล Transaction ทั้งหมดหากพบเลข repair ซ้ำ
  const repairHistorySection = document.getElementById("repair-history-section");
  const transactionTableBody = document.querySelector("#transaction-table tbody");
  const summaryTableBody = document.querySelector("#summary-table tbody");

  async function loadRepairHistory(repair) {
    try {
      const response = await fetch(
        `/get-transactions-summary?repair=${repair}`
      );
      const data = await response.json();

      if (response.ok && data.transactions && data.transactions.length > 0) {
        repairHistorySection.classList.remove("d-none");
        transactionTableBody.innerHTML = "";
        summaryTableBody.innerHTML = "";

        // --- ตาราง Transaction
        let count = 1;
        data.transactions.forEach((transaction) => {
          const createdAt = new Date(transaction.createdAt).toLocaleString(
            "en-GB",
            {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            }
          );

          transaction.products.forEach((product, index) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
            <td class="text-center">${index === 0 ? count : ""}</td>
            <td class="text-center">${product.sku}</td>
            <td>${product.description || ""}</td>
            <td class="text-center">${product.quantity}</td>
            <td class="text-center">${transaction.transactionType}</td>
            <td class="text-center">${createdAt}</td>
          `;
            transactionTableBody.appendChild(tr);
          });

          count++;
        });

        // --- สรุปยอด (Summary)
        const summary = {};
        data.transactions.forEach((tr) => {
          tr.products.forEach((p) => {
            if (!summary[p.sku]) {
              summary[p.sku] = {
                description: p.description || "",
                net: 0,
              };
            }
            summary[p.sku].net +=
              tr.transactionType === "IN" ? p.quantity : -p.quantity;
          });
        });

        let summaryIndex = 1;
        for (const sku in summary) {
          const tr = document.createElement("tr");
          tr.innerHTML = `
          <td class="text-center">${summaryIndex++}</td>
          <td class="text-center">${sku}</td>
          <td>${summary[sku].description}</td>
          <td class="text-center">${summary[sku].net}</td>
        `;
          summaryTableBody.appendChild(tr);
        }
      } else {
        // ไม่พบ transaction
        repairHistorySection.classList.add("d-none");
      }
    } catch (error) {
      console.error("Error loading repair history:", error);
      repairHistorySection.classList.add("d-none");
    }
  }

  // การบันทึกข้อมูล
  document.querySelector("form").addEventListener("submit", function (event) {
    event.preventDefault();

    const submitButton = this.querySelector('button[type="submit"]');
    submitButton.disabled = true; // ปิดปุ่ม
    submitButton.innerHTML = "⏳ กำลังบันทึก..."; // เปลี่ยนข้อความ

    const alertContainer = document.getElementById("alert-container");
    const name = document.querySelector('[name="name"]').value;
    const repair = document.querySelector('[name="repair"]').value;
    const workStatus = document.querySelector('[name="workStatus"]').value;
    const storeId = document.querySelector('[name="storeId"]').value; // ดึงค่า storeId

    const products = Array.from(
      document.querySelectorAll("table tbody tr")
    ).map((row) => ({
      sku: row.querySelector(".sku-input").value,
      description: row.querySelector(".description-cell").textContent,
      quantity: parseInt(row.querySelector('[name="quantity"]').value, 10),
      cost:
        parseFloat(
          row.querySelector(".cost-cell").textContent.replace(/,/g, "")
        ) || 0,
    }));

    fetch("/add_trans-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, repair, workStatus, storeId, products }), // ส่ง storeId ไปด้วย
    })
      .then((response) => {
        if (response.ok) {
          return response.json();
        }
        throw new Error("Failed to save data");
      })
      .then((data) => {
        alertContainer.innerHTML = `
          <div class="container mt-5 col-md-9 justify-content-center alert alert-success alert-dismissible fade show" role="alert">
            <strong>สำเร็จ!</strong> บันทึกข้อมูลเรียบร้อยแล้ว.
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
          </div>
        `;
      })
      .catch((error) => {
        console.error("Error:", error);
        submitButton.disabled = false;
        submitButton.innerHTML = "บันทึกข้อมูล"; // คืนค่าเดิม
        alertContainer.innerHTML = `
          <div class="container mt-5 col-md-9 justify-content-center alert alert-danger alert-dismissible fade show" role="alert">
            <strong>ผิดพลาด!</strong> ไม่สามารถบันทึกข้อมูลได้.
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
          </div>
        `;
      });
    setTimeout(() => {
      const alerts = document.querySelectorAll(".alert");
      alerts.forEach((alert) => alert.classList.remove("show"));

      // รีโหลดหน้า
      window.location.reload();
    }, 2500);
  });
});
