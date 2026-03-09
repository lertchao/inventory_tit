let __PRINT_DATA__ = null;

document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("manualIssueForm");
  const alertContainer = document.getElementById("alert-container");
  const storeIdInput = document.getElementById("storeId");
  const storenameInput = document.getElementById("storename");
  const manualRequestIdInput = document.getElementById("manualRequestId");
  const printActions = document.getElementById("printActions");
  const printPreviewCard = document.getElementById("printPreviewCard");
  const printPreviewContent = document.getElementById("printPreviewContent");
  const printSlipBtn = document.getElementById("printSlipBtn");
  const newDocBtn = document.getElementById("newDocBtn");

  async function loadNextRequestId() {
    try {
      const res = await fetch("/api/manual-issue-next-id");
      const data = await res.json();
      manualRequestIdInput.value = res.ok ? (data.requestId || "") : "";
    } catch (error) {
      console.error("Error loading request id:", error);
      manualRequestIdInput.value = "";
    }
  }

  loadNextRequestId();

  function updateRemoveButtons() {
    const rows = document.querySelectorAll(".form_out tbody tr");
    const removeButtons = document.querySelectorAll(".remove-row");
    removeButtons.forEach((button) => {
      button.style.display = rows.length > 1 ? "inline-block" : "none";
    });
  }

  updateRemoveButtons();

  document.addEventListener("input", function (event) {
    if (event.target.classList.contains("sku-input")) {
      const sku = event.target.value.trim();
      const row = event.target.closest("tr");
      const descriptionCell = row.querySelector(".description-cell");
      const costCell = row.querySelector(".cost-cell");

      if (!sku) {
        descriptionCell.textContent = "";
        costCell.textContent = "";
        descriptionCell.classList.remove("text-danger", "text-dark");
        costCell.classList.remove("text-danger", "text-dark");
        validateDuplicateSkusOUT();
        return;
      }

      fetch(`/get-product-details?sku=${encodeURIComponent(sku)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.product) {
            descriptionCell.textContent = data.product.description || "ไม่พบข้อมูล";
            descriptionCell.classList.remove("text-danger");
            descriptionCell.classList.add("text-dark");

            costCell.textContent = new Intl.NumberFormat().format(data.product.cost || 0);
            costCell.classList.remove("text-danger");
            costCell.classList.add("text-dark");
          } else {
            descriptionCell.textContent = "ไม่พบข้อมูล SKU";
            descriptionCell.classList.remove("text-dark");
            descriptionCell.classList.add("text-danger");

            costCell.textContent = "ไม่พบข้อมูล";
            costCell.classList.remove("text-dark");
            costCell.classList.add("text-danger");
          }
          validateDuplicateSkusOUT();
        })
        .catch((err) => {
          console.error("Error fetching product details:", err);
          descriptionCell.textContent = "เกิดข้อผิดพลาด";
          descriptionCell.classList.add("text-danger");
          costCell.textContent = "เกิดข้อผิดพลาด";
          costCell.classList.add("text-danger");
          validateDuplicateSkusOUT();
        });
    }
  });

  storeIdInput.addEventListener("input", async function () {
    const storeId = storeIdInput.value.trim();
    storenameInput.value = "";

    if (!storeId) {
      storenameInput.classList.remove("text-danger");
      return;
    }

    try {
      const response = await fetch(`/get-store-name?storeId=${encodeURIComponent(storeId)}`);
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

  document.querySelector(".add-row").addEventListener("click", function () {
    const tableBody = document.querySelector(".form_out tbody");
    const newRow = `
      <tr>
        <td>
          <input type="text" class="form-control sku-input" placeholder="กรอกรหัสสินค้า" name="sku" required>
        </td>
        <td class="text-start align-middle description-cell"></td>
        <td>
          <input type="number" class="form-control text-center" placeholder="กรอกจำนวน" name="quantity" value="1" min="1" required>
        </td>
        <td class="text-center align-middle cost-cell"></td>
        <td class="text-center">
          <button type="button" class="btn btn-danger btn-sm remove-row">ลบ</button>
        </td>
      </tr>
    `;
    tableBody.insertAdjacentHTML("beforeend", newRow);
    updateRemoveButtons();
    validateDuplicateSkusOUT();
  });

  document.addEventListener("click", function (event) {
    if (event.target.classList.contains("remove-row")) {
      event.target.closest("tr").remove();
      updateRemoveButtons();
      validateDuplicateSkusOUT();
    }
  });

  function validateDuplicateSkusOUT() {
    const rows = Array.from(document.querySelectorAll("table.form_out tbody tr"));
    const submitBtn = form.querySelector('button[type="submit"]');

    const seen = new Set();
    const dups = new Set();

    rows.forEach((row) => {
      const inp = row.querySelector(".sku-input");
      const val = (inp?.value || "").trim().toUpperCase();
      if (!val) return;
      if (seen.has(val)) dups.add(val);
      else seen.add(val);
    });

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

    if (dups.size > 0) {
      submitBtn.disabled = true;
      alertContainer.innerHTML = `
        <div class="alert alert-danger alert-dismissible fade show" role="alert">
          <strong>พบรหัสซ้ำ:</strong> ${[...dups].join(", ")} — โปรดรวมให้เหลือรหัสละ 1 แถวก่อนบันทึก
          <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
      `;
      return false;
    }

    if (alertContainer.querySelector(".alert-danger")) {
      alertContainer.innerHTML = "";
    }

    submitBtn.disabled = false;
    return true;
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();

    if (!validateDuplicateSkusOUT()) return;

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.innerHTML = "⏳ กำลังบันทึก...";

    const name = document.querySelector('[name="name"]').value.trim();
    const workStatus = document.querySelector('[name="workStatus"]').value;
    const storeId = document.querySelector('[name="storeId"]').value.trim();

    const products = Array.from(document.querySelectorAll(".form_out tbody tr"))
      .map((row) => {
        const skuEl = row.querySelector(".sku-input");
        const descEl = row.querySelector(".description-cell");
        const qtyEl = row.querySelector('[name="quantity"]');
        const costEl = row.querySelector(".cost-cell");

        return {
          sku: skuEl?.value.trim() || "",
          description: descEl?.textContent.trim() || "",
          quantity: parseInt(qtyEl?.value, 10),
          cost: parseFloat((costEl?.textContent || "0").replace(/,/g, "")) || 0,
        };
      })
      .filter((item) => item.sku && item.quantity > 0);

    try {
      const response = await fetch("/add_manual_trans-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, workStatus, storeId, products }),
      });

      const data = await response.json();

      if (!response.ok) throw data;

      __PRINT_DATA__ = data.printData;

      alertContainer.innerHTML = `
        <div class="alert alert-success alert-dismissible fade show" role="alert">
          <strong>สำเร็จ!</strong> ${data.message}
          <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
      `;

      manualRequestIdInput.value = data.printData.requestId || "";

      renderPrintPreview(__PRINT_DATA__);
      printActions.style.display = "block";
      printPreviewCard.style.display = "block";

      form.querySelectorAll("input, select, button").forEach((el) => {
        if (el.id !== "printSlipBtn" && el.id !== "newDocBtn") {
          el.disabled = true;
        }
      });
    } catch (error) {
      console.error("Error saving:", error);
      submitButton.disabled = false;
      submitButton.innerHTML = "บันทึกข้อมูล";

      alertContainer.innerHTML = `
        <div class="alert alert-danger alert-dismissible fade show" role="alert">
          <strong>เกิดข้อผิดพลาด!</strong> ${error.alert || error.error || "ไม่สามารถบันทึกข้อมูลได้"}
          <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
      `;
    }
  });

  function renderPrintPreview(data) {
    if (!data) return;

    const grandTotal = data.products.reduce((sum, item) => sum + (Number(item.total) || 0), 0);

    printPreviewContent.innerHTML = `
      <div class="row mb-3">
        <div class="col-md-6"><strong>ชื่อผู้เบิก:</strong> ${escapeHtml(data.requesterName || "")}</div>
        <div class="col-md-6"><strong>เลขที่ใบเบิก:</strong> ${escapeHtml(data.requestId || "")}</div>
        <div class="col-md-6"><strong>รหัสสาขา:</strong> ${escapeHtml(String(data.storeId || ""))}</div>
        <div class="col-md-6"><strong>ชื่อสาขา:</strong> ${escapeHtml(data.storeName || "")}</div>
      </div>

      <div class="table-responsive">
        <table class="table table-bordered table-sm">
          <thead class="table-light">
            <tr>
              <th class="text-center">#</th>
              <th class="text-center">SKU</th>
              <th>Description</th>
              <th class="text-center">Qty</th>
              <th class="text-center">Cost/pcs.</th>
              <th class="text-center">Total</th>
            </tr>
          </thead>
          <tbody>
            ${data.products.map((item) => `
              <tr>
                <td class="text-center">${item.no}</td>
                <td class="text-center">${escapeHtml(item.sku)}</td>
                <td>${escapeHtml(item.description || "")}</td>
                <td class="text-center">${item.quantity}</td>
                <td class="text-center">${formatNumber(item.cost)}</td>
                <td class="text-center">${formatNumber(item.total)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="d-flex justify-content-end mt-3">
        <div class="text-end border rounded px-4 py-3 bg-light" style="min-width: 260px;">
          <div style="font-size: 14px;" class="text-muted">Total Amount (THB)</div>
          <div style="font-size: 28px; font-weight: 700; line-height: 1.2;">
            ${formatNumber(grandTotal)}
          </div>
        </div>
      </div>
    `;
  }

  printSlipBtn.addEventListener("click", function () {
    if (!__PRINT_DATA__) return;

    const grandTotal = __PRINT_DATA__.products.reduce(
      (sum, item) => sum + (Number(item.total) || 0),
      0
    );

    const printWindow = window.open("", "_blank", "width=900,height=1200");

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Manual Issue Parts Slip</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 15mm 18mm 15mm 12mm;
          }

          * {
            box-sizing: border-box;
          }

          html, body {
            margin: 0;
            padding: 0;
            color: #000;
            font-family: Arial, sans-serif;
            font-size: 12px;
          }

          body {
            background: #fff;
          }

          .page {
            width: 100%;
            max-width: 172mm;
            margin: 0 auto;
          }

          .title {
            font-size: 20px;
            font-weight: bold;
            text-align: center;
            margin: 0 0 14px 0;
          }

          .info {
            margin-bottom: 10px;
            line-height: 1.6;
          }

          .info-row {
            display: flex;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 2px;
          }

          .info-col {
            width: 48%;
            word-break: break-word;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            margin-top: 10px;
          }

          th, td {
            border: 1px solid #000;
            padding: 5px 4px;
            vertical-align: top;
            word-break: break-word;
            overflow-wrap: anywhere;
            font-size: 11px;
          }

          th {
            background: #f2f2f2;
            text-align: center;
            font-weight: bold;
          }

          td.text-center,
          th.text-center {
            text-align: center;
          }

          .col-no { width: 8%; }
          .col-sku { width: 15%; }
          .col-desc { width: 31%; }
          .col-qty { width: 10%; }
          .col-cost { width: 16%; }
          .col-total { width: 20%; }

          .amount-wrap {
            margin-top: 14px;
            display: flex;
            justify-content: flex-end;
          }

          .amount-box {
            width: 210px;
            text-align: right;
            border: 1px solid #000;
            padding: 10px 12px;
          }

          .amount-label {
            font-size: 12px;
          }

          .amount-value {
            font-size: 22px;
            font-weight: bold;
            line-height: 1.2;
            margin-top: 4px;
          }

          .sign-row {
            display: flex;
            justify-content: center;
            gap: 50px;
            margin-top: 55px;
          }

          .sign-box {
            width: 150px;
            text-align: center;
          }

          .sign-line {
            margin-top: 42px;
            border-top: 1px solid #000;
            padding-top: 6px;
          }

          @media print {
            html, body {
              width: auto !important;
              height: auto !important;
              margin: 0 !important;
              padding: 0 !important;
            }

            .page {
              width: 100% !important;
              max-width: 172mm !important;
              margin: 0 auto !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="title">Manual Issue Parts</div>

          <div class="info">
            <div class="info-row">
              <div class="info-col"><strong>ชื่อผู้เบิก:</strong> ${escapeHtml(__PRINT_DATA__.requesterName || "")}</div>
              <div class="info-col"><strong>เลขที่ใบเบิก:</strong> ${escapeHtml(__PRINT_DATA__.requestId || "")}</div>
            </div>
            <div class="info-row">
              <div class="info-col"><strong>รหัสสาขา:</strong> ${escapeHtml(String(__PRINT_DATA__.storeId || ""))}</div>
              <div class="info-col"><strong>ชื่อสาขา:</strong> ${escapeHtml(__PRINT_DATA__.storeName || "")}</div>
            </div>
            <div class="info-row">
              <div class="info-col"><strong>สถานะ:</strong> ${escapeHtml(__PRINT_DATA__.workStatus || "")}</div>
              <div class="info-col"><strong>วันที่:</strong> ${dayjs(__PRINT_DATA__.createdAt).tz("Asia/Bangkok").format("DD/MM/YYYY HH:mm")}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th class="text-center col-no">#</th>
                <th class="text-center col-sku">SKU</th>
                <th class="col-desc">Description</th>
                <th class="text-center col-qty">Qty</th>
                <th class="text-center col-cost">Cost/pcs.</th>
                <th class="text-center col-total">Total</th>
              </tr>
            </thead>
            <tbody>
              ${__PRINT_DATA__.products.map((item) => `
                <tr>
                  <td class="text-center">${item.no}</td>
                  <td class="text-center">${escapeHtml(item.sku)}</td>
                  <td>${escapeHtml(item.description || "")}</td>
                  <td class="text-center">${formatNumber(item.quantity)}</td>
                  <td class="text-center">${formatNumber(item.cost)}</td>
                  <td class="text-center">${formatNumber(item.total)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>

          <div class="amount-wrap">
            <div class="amount-box">
              <div class="amount-label">Total Amount (THB)</div>
              <div class="amount-value">${formatNumber(grandTotal)}</div>
            </div>
          </div>

          <div class="sign-row">
            <div class="sign-box">
              <div class="sign-line">FSE / AFSM</div>
            </div>
            <div class="sign-box">
              <div class="sign-line">Inventory</div>
            </div>
          </div>
        </div>

        <script>
          window.onload = function () {
            window.print();
          };
        <\/script>
      </body>
      </html>
    `);

    printWindow.document.close();
  });

  newDocBtn.addEventListener("click", function () {
    window.location.reload();
  });

  function formatNumber(num) {
    return new Intl.NumberFormat().format(Number(num || 0));
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});