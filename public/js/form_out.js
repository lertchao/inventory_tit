// ========================== form_out.js (FULL) ==========================

// ===== Cancel guard helpers (global) =====
let __IS_CANCELED__ = false;

function setFormDisabled(disabled) {
  const form = document.querySelector("form");
  if (!form) return;

  const submitBtn = form.querySelector("button[type='submit']");
  if (submitBtn) submitBtn.disabled = disabled;

  const addBtn = document.querySelector(".add-row");
  if (addBtn) addBtn.disabled = disabled;

  // ช่องที่ต้อง "คงเปิดไว้เสมอ" แม้จะเป็น Cancel
  const keepEnabledNames = new Set(["repair"]); // 👈 เลขที่ใบเบิก

  form.querySelectorAll("input, select, textarea, button.remove-row").forEach((el) => {
    if (el === submitBtn) return;                 // ข้ามปุ่ม submit (จัดการด้านบนแล้ว)
    if (keepEnabledNames.has(el.name)) {          // 👈 อย่าล็อคช่อง repair
      el.disabled = false;
      return;
    }
    el.disabled = disabled;                       // ล็อคอย่างอื่นตามปกติ
  });

  // Select2 ต้องสั่งผ่าน jQuery
  try {
    $("#requesterName").prop("disabled", disabled).trigger("change.select2");
  } catch (e) {}
}


function updateCancelUI(isCanceled /*, requestId */) {
  __IS_CANCELED__ = !!isCanceled;
  const banner = document.getElementById("status-banner");

  if (__IS_CANCELED__) {
    if (banner) {
      banner.className = "alert alert-danger mt-2";
      banner.innerHTML = 'ใบงานนี้ถูก <b>Cancel</b> แล้ว — ไม่สามารถเพิ่มรายการ OUT ได้';
    }
    setFormDisabled(true);
  } else {
    if (banner) {
      banner.className = "alert d-none mt-2";
      banner.innerHTML = "";
    }
    setFormDisabled(false);
  }
}

// ✅ เติม option ให้ select ถ้ายังไม่มี แล้วเลือกค่านั้น (ใช้กับ "Cancel")
function ensureStatusOptionAndSelect(selectEl, status) {
  if (!selectEl) return;
  const exists = Array.from(selectEl.options).some((o) => o.value === status);
  if (!exists) {
    const opt = new Option(status, status);
    if (status === "Cancel") opt.disabled = true; // แสดงได้ แต่ห้ามผู้ใช้เปลี่ยนมาเลือกเอง
    selectEl.add(opt);
  }
  selectEl.value = status;
}

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
              descriptionCell.textContent = data.product.description || "ไม่พบข้อมูล";
              descriptionCell.classList.remove("text-danger");
              descriptionCell.classList.add("text-dark");
              costCell.classList.remove("text-danger");
              costCell.classList.add("text-dark");
              costCell.textContent =
                new Intl.NumberFormat().format(data.product.cost) || "ไม่พบข้อมูล";
            } else {
              descriptionCell.textContent = "ไม่พบข้อมูล SKU";
              descriptionCell.classList.remove("text-dark");
              descriptionCell.classList.add("text-danger");
              costCell.textContent = "ไม่พบข้อมูล";
              costCell.classList.remove("text-dark");
              costCell.classList.add("text-danger");
            }
          })
          .catch((error) => {
            console.error("Error fetching product details:", error);
            descriptionCell.textContent = "เกิดข้อผิดพลาด";
            descriptionCell.classList.add("text-danger");
            costCell.textContent = "เกิดข้อผิดพลาด";
          });
      } else {
        descriptionCell.textContent = "";
        descriptionCell.classList.remove("text-danger", "text-dark");
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
        storenameInput.classList.remove("text-danger");
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
    if (__IS_CANCELED__) return; // กันเพิ่มเมื่อ Cancel
    const tableBody = document.querySelector("table tbody");
    const newRow = `
      <tr>
        <td><input type="text" class="form-control sku-input" placeholder="กรอกรหัสสินค้า" name="sku" required></td>
        <td class="text-start align-middle description-cell"></td>
        <td><input type="number" class="form-control text-center" placeholder="กรอกจำนวน" name="quantity" value="1" required></td>
        <td class="text-center align-middle cost-cell"></td>
        <td class="text-center"><button type="button" class="btn btn-danger btn-sm remove-row">ลบ</button></td>
      </tr>`;
    tableBody.insertAdjacentHTML("beforeend", newRow);
    updateRemoveButtons();
  });

  // ลบแถว
  document.addEventListener("click", function (event) {
    if (event.target.classList.contains("remove-row")) {
      if (__IS_CANCELED__) return; // กันลบเมื่อ Cancel
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
  const storenameInputField = document.getElementById("storename");

  const repairHistorySection = document.getElementById("repair-history-section");
  const transactionTableBody = document.querySelector("#transaction-table tbody");
  const summaryTableBody = document.querySelector("#summary-table tbody");

  repairInput.addEventListener("input", async function () {
    const repair = repairInput.value.trim();

    if (!repair) {
      nameInput.value = "";
      $("#requesterName").val(null).trigger("change");
      workStatusInput.value = "Pending";
      storeIdInputField.value = "";
      storenameInputField.value = "";
      if (repairHistorySection) repairHistorySection.classList.add("d-none");
      updateCancelUI(false);
      return;
    }

    try {
      const response = await fetch(`/get-transaction-details?repair=${encodeURIComponent(repair)}`);
      const data = await response.json();

      if (response.ok && data.transaction) {
        // ===== Prefill requesterName ให้ Select2 =====
        const selectedName = (data.transaction.requesterName || '').trim();
        nameInput.value = selectedName;

        const $sel = $('#requesterName');
        if (selectedName) {
          const hasOption = $sel.find(`option[value="${selectedName.replace(/"/g, '\\"')}"]`).length > 0;
          if (!hasOption) {
            $sel.append(new Option(selectedName, selectedName, true, true)).trigger('change');
          } else {
            $sel.val(selectedName).trigger('change');
          }
        } else {
          $sel.val(null).trigger('change');
        }
        // =============================================

        const status = data.transaction.workStatus || 'Pending';
        if (status.toLowerCase() === 'cancel') {
          ensureStatusOptionAndSelect(workStatusInput, 'Cancel');
          updateCancelUI(true);
        } else {
          workStatusInput.value = status;
          updateCancelUI(false);
        }

        storeIdInputField.value = data.transaction.storeId ?? '';
        storenameInputField.value = data.transaction.storeName || '';

        // กระตุ้นให้ไปดึงชื่อสาขาตาม storeId
        storeIdInputField.dispatchEvent(new Event('input'));
      } else {
        nameInput.value = '';
        $('#requesterName').val(null).trigger('change');
        workStatusInput.value = 'Pending';
        storeIdInputField.value = '';
        storenameInputField.value = '';
        updateCancelUI(false);
      }

      await loadRepairHistory(repair);
    } catch (error) {
      console.error('Error fetching transaction details:', error);
      nameInput.value = '';
      $('#requesterName').val(null).trigger('change');
      workStatusInput.value = '';
      storeIdInputField.value = '';
      storenameInputField.value = '';
      if (repairHistorySection) repairHistorySection.classList.add('d-none');
      updateCancelUI(false);
    }
  });

  // โหลดข้อมูล Transaction ทั้งหมดหากพบเลข repair ซ้ำ
  async function loadRepairHistory(repair) {
    try {
      const response = await fetch(`/get-transactions-summary?repair=${repair}`);
      const data = await response.json();

      if (response.ok && data.transactions && data.transactions.length > 0) {
        if (repairHistorySection) repairHistorySection.classList.remove("d-none");
        if (transactionTableBody) transactionTableBody.innerHTML = "";
        if (summaryTableBody) summaryTableBody.innerHTML = "";

        // ✅ ถ้ามีรายการไหน workStatus = Cancel ให้ล็อกฟอร์มทันที + set select เป็น Cancel
        const anyCanceled = data.transactions.some(
          (tx) => (tx.workStatus || "").toLowerCase() === "cancel"
        );
        if (anyCanceled) {
          ensureStatusOptionAndSelect(workStatusInput, "Cancel");
          updateCancelUI(true);
        }

        // --- ตาราง Transaction
        let count = 1;
        data.transactions.forEach((transaction) => {
          const createdAt = dayjs(transaction.createdAt)
            .tz("Asia/Bangkok")
            .format("DD MMM YYYY, HH:mm");

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
            if (transactionTableBody) transactionTableBody.appendChild(tr);
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
            summary[p.sku].net += tr.transactionType === "IN" ? p.quantity : -p.quantity;
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
          if (summaryTableBody) summaryTableBody.appendChild(tr);
        }
      } else {
        if (repairHistorySection) repairHistorySection.classList.add("d-none");
      }
    } catch (error) {
      console.error("Error loading repair history:", error);
      if (repairHistorySection) repairHistorySection.classList.add("d-none");
    }
  }

  // ===== Submit (กัน Cancel + แสดงผล) =====
  const theForm = document.querySelector("form");
  if (theForm) {
    theForm.addEventListener("submit", function (event) {
      event.preventDefault();

      const alertContainer = document.getElementById("alert-container");

      // ⛔ กันเคส Cancel แบบชัวร์ ๆ
      if (__IS_CANCELED__) {
        alertContainer.innerHTML = `<div class="alert alert-danger alert-dismissible fade show" role="alert">
          ใบงานนี้ถูก <b>Cancel</b> แล้ว — ไม่สามารถเพิ่มรายการ OUT ได้
          <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>`;
        return;
      }

      const submitButton = this.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.innerHTML = "⏳ กำลังบันทึก...";

      const name = document.querySelector('[name="name"]').value.trim();
      const repair = document.querySelector('[name="repair"]').value.trim();
      const workStatus = document.querySelector('[name="workStatus"]').value;
      const storeId = document.querySelector('[name="storeId"]').value.trim();

      const products = Array.from(document.querySelectorAll("table tbody tr"))
        .map((row) => {
          const skuEl = row.querySelector(".sku-input");
          const descEl = row.querySelector(".description-cell");
          const qtyEl = row.querySelector('[name="quantity"]');
          const costEl = row.querySelector(".cost-cell");
          if (!skuEl || !descEl || !qtyEl || !costEl) return null;
          return {
            sku: skuEl.value.trim(),
            description: descEl.textContent.trim(),
            quantity: parseInt(qtyEl.value, 10),
            cost: parseFloat(costEl.textContent.replace(/,/g, "")) || 0,
          };
        })
        .filter(Boolean);

      fetch("/add_trans-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, repair, workStatus, storeId, products }),
      })
        .then(async (response) => {
          const data = await response.json();

          if (!response.ok) {
            throw data;
          }

          alertContainer.innerHTML = `<div class="alert alert-success alert-dismissible fade show" role="alert">
            <strong>สำเร็จ!</strong> ${data.message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
          </div>`;
          setTimeout(() => window.location.reload(), 2500);
        })
        .catch((error) => {
          console.error("Error saving:", error);
          submitButton.disabled = false;
          submitButton.innerHTML = "บันทึกข้อมูล";

          alertContainer.innerHTML = `<div class="alert alert-danger alert-dismissible fade show" role="alert">
            <strong>เกิดข้อผิดพลาด!</strong> ${error.alert || error.error || "ไม่สามารถบันทึกข้อมูลได้"}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
          </div>`;
        });
    });
  }

  // === ป้องกัน SKU ซ้ำในฟอร์ม OUT — UI เตือน + คุมปุ่ม submit ===
  (function () {
    function validateDuplicateSkusOUT() {
      const rows = Array.from(document.querySelectorAll("table.form_out tbody tr"));
      const submitBtn = document.querySelector('button[type="submit"]');
      const alertContainer =
        document.getElementById("alert-container") ||
        (() => {
          const div = document.createElement("div");
          div.id = "alert-container";
          const form = document.querySelector("form") || document.body;
          form.parentNode.insertBefore(div, form.nextSibling);
          return div;
        })();

      const seen = new Set();
      const dups = new Set();

      rows.forEach((row) => {
        const inp = row.querySelector(".sku-input");
        const val = (inp?.value || "").trim().toUpperCase();
        if (!val) return;
        if (seen.has(val)) dups.add(val);
        else seen.add(val);
      });

      // ไฮไลต์แถวที่ซ้ำ
      rows.forEach((row) => {
        const inp = row.querySelector(".sku-input");
        const v = (inp?.value || "").trim().toUpperCase();
        row.classList.remove("table-danger");
        inp?.classList.remove("is-invalid");
        if (v && dups.has(v)) {
          row.classList.add("table-danger");
          inp?.classList.add("is-invalid");
        }
      });

      if (submitBtn) {
        if (dups.size > 0) {
          submitBtn.disabled = true;
        } else {
          // อย่า enable ถ้าใบงานถูก Cancel
          submitBtn.disabled = __IS_CANCELED__ ? true : false;
        }
      }

      if (dups.size > 0) {
        alertContainer.innerHTML = `
          <div class="alert alert-danger alert-dismissible fade show" role="alert">
            <strong>พบรหัสซ้ำ:</strong> ${[...dups].join(", ")} — โปรดรวมให้เหลือรหัสละ 1 แถวก่อนบันทึก
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
          </div>`;
        return false;
      } else {
        return true;
      }
    }

    // ตรวจทุกครั้งที่พิมพ์/เพิ่ม/ลบแถว
    document.addEventListener("input", (e) => {
      if (e.target.classList.contains("sku-input")) validateDuplicateSkusOUT();
    });
    document.addEventListener("click", (e) => {
      if (e.target.classList.contains("add-row") || e.target.classList.contains("remove-row")) {
        setTimeout(validateDuplicateSkusOUT, 0);
      }
    });

    // กันตอน submit อีกรอบ
    const formEl =
      document.querySelector("form[action='/add_trans-out']") ||
      document.querySelector("form");
    if (formEl) {
      formEl.addEventListener("submit", (e) => {
        if (!validateDuplicateSkusOUT()) {
          e.preventDefault();
          e.stopPropagation();
        }
      });
    }
  })();
});
