document.addEventListener("DOMContentLoaded", function () {
  // ฟังก์ชันสำหรับอัปเดตการแสดงปุ่มลบ
  function updateRemoveButtons() {
    const rows = document.querySelectorAll("table tbody tr");
    const removeButtons = document.querySelectorAll(".remove-row");

    removeButtons.forEach((button) => {
      button.style.display = rows.length > 1 ? "inline-block" : "none";
    });
  }

  // เมื่อผู้ใช้กรอก SKU
  document.addEventListener("input", async function (event) {
    if (event.target.classList.contains("sku-input")) {
      const sku = event.target.value.trim();
      const row = event.target.closest("tr");
      const descriptionCell = row.querySelector(".description-cell");
      const costCell = row.querySelector(".cost-cell");

      if (!sku) {
        descriptionCell.textContent = "";
        descriptionCell.classList.remove("text-danger", "text-dark");
        costCell.textContent = "";
        return;
      }

      try {
        const response = await fetch(`/get-product-details?sku=${sku}`);
        const data = await response.json();

        if (data && data.product) {
          descriptionCell.textContent = data.product.description || "ไม่พบข้อมูล";
          descriptionCell.classList.replace("text-danger", "text-dark");
          costCell.classList.replace("text-danger", "text-dark");
          costCell.textContent = new Intl.NumberFormat().format(data.product.cost) || "ไม่พบข้อมูล";
        } else {
          descriptionCell.textContent = "ไม่พบข้อมูล SKU";
          descriptionCell.classList.replace("text-dark", "text-danger");
          costCell.textContent = "ไม่พบข้อมูล";
          costCell.classList.replace("text-dark", "text-danger");
        }
      } catch (error) {
        console.error("Error fetching product details:", error);
        descriptionCell.textContent = "เกิดข้อผิดพลาด";
        descriptionCell.classList.add("text-danger");
        costCell.textContent = "เกิดข้อผิดพลาด";
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
        <td><input type="text" class="form-control sku-input" placeholder="กรอกรหัสสินค้า" name="sku" required></td>
        <td class="text-center description-cell"></td>
        <td><input type="number" class="form-control text-center" placeholder="กรอกจำนวน" name="quantity" value="1" required></td>
        <td class="text-center cost-cell"></td>
        <td class="text-center"><button type="button" class="btn btn-danger btn-sm remove-row">ลบ</button></td>
      </tr>`;
    tableBody.insertAdjacentHTML("beforeend", newRow);
    updateRemoveButtons();
  });

  // ลบแถว
  document.addEventListener("click", function (event) {
    if (event.target.classList.contains("remove-row")) {
      event.target.closest("tr").remove();
      updateRemoveButtons();
    }
  });

  // อัปเดตปุ่มลบตอนโหลดหน้าเว็บ
  updateRemoveButtons();


// ฟังก์ชันตรวจสอบเลขที่ใบเบิกและกรอกข้อมูลอัตโนมัติ
const repairInput = document.querySelector('[name="repair"]');
const nameInput = document.querySelector('[name="name"]');
const workStatusInput = document.querySelector('[name="workStatus"]');
const storeIdInputField = document.querySelector('[name="storeId"]');
const storenameInputField = document.getElementById('storename');
  
repairInput.addEventListener('input', async function () {
  const repair = repairInput.value.trim();

  if (!repair) {
    // ถ้าไม่มีการกรอกเลขที่ใบเบิก ให้เคลียร์ข้อมูล
    nameInput.value = '';
    workStatusInput.value = 'Pending';
    storeIdInputField.value = '';
    storenameInputField.value = '';
    return;
  }

  try {
    const response = await fetch(`/get-transaction-details?repair=${repair}`);
    const data = await response.json();

    if (response.ok && data.transaction) {
      // หากพบข้อมูล transaction ในฐานข้อมูล
      nameInput.value = data.transaction.requesterName;
      workStatusInput.value = data.transaction.workStatus || 'Pending';
      storeIdInputField.value = data.transaction.storeId;
      storenameInputField.value = data.transaction.storeName || ''; // ถ้า storeName มีค่า ให้แสดง

      // เรียกใช้งานฟังก์ชันค้นหาชื่อสาขาหลังจากกรอก storeId
      storeIdInputField.dispatchEvent(new Event('input'));
    } else {
      // หากไม่พบข้อมูล ให้ปล่อยให้ฟอร์มเป็นค่าว่าง
      nameInput.value = '';
      workStatusInput.value = 'Pending';
      storeIdInputField.value = '';
      storenameInputField.value = '';
    }
  } catch (error) {
    console.error('Error fetching transaction details:', error);
    // ถ้าเกิดข้อผิดพลาด ให้เคลียร์ค่าหรือแสดงข้อความผิดพลาด
    nameInput.value = '';
    workStatusInput.value = '';
    storeIdInputField.value = '';
    storenameInputField.value = '';
  }
});


  // เมื่อกดปุ่ม submit
  document.querySelector("form").addEventListener("submit", async function (event) {
    event.preventDefault();
  
    const alertContainer = document.getElementById("alert-container");
    const name = document.querySelector('[name="name"]').value.trim();
    const repair = document.querySelector('[name="repair"]').value.trim();
    const workStatus = document.querySelector('[name="workStatus"]').value.trim();
    const storeId = document.querySelector('[name="storeId"]').value.trim(); // เพิ่ม storeId
  
    if (!name || !repair || !workStatus || !storeId) {
      alertContainer.innerHTML = `
        <div class="alert alert-warning alert-dismissible fade show" role="alert">
          <strong>แจ้งเตือน!</strong> กรุณากรอกข้อมูลให้ครบถ้วน.
          <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>`;
      return;
    }
  
    const products = Array.from(document.querySelectorAll("table tbody tr")).map((row) => ({
      sku: row.querySelector(".sku-input").value.trim(),
      description: row.querySelector(".description-cell").textContent,
      quantity: parseInt(row.querySelector('[name="quantity"]').value, 10),
      cost: parseFloat(row.querySelector(".cost-cell").textContent.replace(/,/g, "")) || 0,
    }));
  
    try {
      const response = await fetch("/add_trans-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, repair, workStatus, products, storeId }), // ส่ง storeId
      });
  
      const data = await response.json();
  
      if (response.ok) {
        alertContainer.innerHTML = `
          <div class="alert alert-success alert-dismissible fade show" role="alert">
            <strong>สำเร็จ!</strong> บันทึกข้อมูลเรียบร้อยแล้ว.
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
          </div>`;
  
        setTimeout(() => window.location.reload(), 2500);
      } else {
        throw new Error(data.error || "ไม่สามารถบันทึกข้อมูลได้");
      }
    } catch (error) {
      console.error("Error:", error);
      alertContainer.innerHTML = `
        <div class="alert alert-danger alert-dismissible fade show" role="alert">
          <strong>ผิดพลาด!</strong> ${error.message}
          <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>`;
    }
  });
  
});
