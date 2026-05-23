// Initialize Supabase client
const SUPABASE_URL = 'https://jirzkyvwfpbblvyivikw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppcnpreXZ3ZnBiYmx2eWl2aWt3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NDcwMDQsImV4cCI6MjA5NTEyMzAwNH0.rlaM5GKsC5WUtEXH_5VINFYDq4tCFdFiLo27s5B6-Xc';
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function loadKMBStops() {
  const { route, bound, service_type } = selectedRoute;

  try {
    // Map bound values: I -> inbound, O -> outbound
    const direction = bound === "I" ? "inbound" : "outbound";
    
    const url = `https://data.etabus.gov.hk/v1/transport/kmb/route-stop/${route}/${direction}/${service_type}`;
    console.log("Loading KMB stops with:", { route, bound, direction, service_type });
    
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const json = await res.json();
    const stops = json.data.sort((a, b) => a.seq - b.seq);

    const tbody = document.getElementById("tableBody");
    tbody.innerHTML = "";

    for (const s of stops) {
      const stopRes = await fetch(
        `https://data.etabus.gov.hk/v1/transport/kmb/stop/${s.stop}`
      );
      const stopJson = await stopRes.json();

      const stopNameTC = stopJson.data.name_tc;
      const stopNameEN = stopJson.data.name_en;

      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${stopNameTC}<br>${stopNameEN}</td>
        <td><input type="time"></td>
        <td><input type="number"></td>
        <td><input type="number"></td>
        <td><input type="number"></td>
        <td><input type="text" placeholder="Notes"></td>
      `;
      tbody.appendChild(row);
      addRowEventListeners(row);
    }
  } catch (error) {
    alert("Error loading stops: " + error.message);
    console.error("Error in loadKMBStops:", error);
  }
}

async function loadCitybusStops() {
  const { route, direction } = selectedRoute;

  try {
    const url = `https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/${route}/${direction}`;
    console.log("Loading Citybus stops with:", { route, direction });
    
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const json = await res.json();
    const stops = json.data.sort((a, b) => a.seq - b.seq);

    const tbody = document.getElementById("tableBody");
    tbody.innerHTML = "";

    for (const s of stops) {
      const stopRes = await fetch(
        `https://rt.data.gov.hk/v2/transport/citybus/stop/${s.stop}`
      );
      const stopJson = await stopRes.json();

      const stopNameTC = stopJson.data.name_tc;
      const stopNameEN = stopJson.data.name_en;

      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${stopNameTC}<br>${stopNameEN}</td>
        <td><input type="time"></td>
        <td><input type="number"></td>
        <td><input type="number"></td>
        <td><input type="number"></td>
        <td><input type="text" placeholder="Notes"></td>
      `;
      tbody.appendChild(row);
      addRowEventListeners(row);
    }
  } catch (error) {
    alert("Error loading stops: " + error.message);
    console.error("Error in loadCitybusStops:", error);
  }
}

let allRoutes = null;

async function getKMBRoutes() {
  const CACHE_KEY = 'kmb_routes';
  const CACHE_TIMESTAMP_KEY = 'kmb_routes_timestamp';
  const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

  try {
    const cachedData = localStorage.getItem(CACHE_KEY);
    const cachedTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    
    if (cachedData && cachedTimestamp) {
      const age = Date.now() - parseInt(cachedTimestamp);
      if (age < CACHE_DURATION) {
        console.log('Using cached KMB routes data');
        return JSON.parse(cachedData);
      }
    }

    console.log('Fetching fresh KMB routes data from API');
    const res = await fetch(`https://data.etabus.gov.hk/v1/transport/kmb/route`);
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();
    
    // Add operator field for filtering
    const routesWithOperator = json.data.map(r => ({ ...r, co: 'KMB' }));
    
    // Cache the data
    localStorage.setItem(CACHE_KEY, JSON.stringify(routesWithOperator));
    localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    
    return routesWithOperator;
  } catch (error) {
    console.error('Error fetching KMB routes:', error);
    const cachedData = localStorage.getItem(CACHE_KEY);
    if (cachedData) {
      console.log('Using expired cached KMB routes data due to API error');
      return JSON.parse(cachedData);
    }
    return [];
  }
}

async function getCitybusRoutes() {
  const CACHE_KEY = 'citybus_routes';
  const CACHE_TIMESTAMP_KEY = 'citybus_routes_timestamp';
  const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

  try {
    const cachedData = localStorage.getItem(CACHE_KEY);
    const cachedTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    
    if (cachedData && cachedTimestamp) {
      const age = Date.now() - parseInt(cachedTimestamp);
      if (age < CACHE_DURATION) {
        console.log('Using cached Citybus routes data');
        return JSON.parse(cachedData);
      }
    }

    console.log('Fetching fresh Citybus routes data from API');
    const res = await fetch(`https://rt.data.gov.hk/v2/transport/citybus/route/ctb`);
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();
    
    // Cache the data
    localStorage.setItem(CACHE_KEY, JSON.stringify(json.data));
    localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    
    return json.data;
  } catch (error) {
    console.error('Error fetching Citybus routes:', error);
    const cachedData = localStorage.getItem(CACHE_KEY);
    if (cachedData) {
      console.log('Using expired cached Citybus routes data due to API error');
      return JSON.parse(cachedData);
    }
    return [];
  }
}

async function getAllRoutes() {
  try {
    const kmbRoutes = await getKMBRoutes();
    const citybusRoutes = await getCitybusRoutes();
    return { kmb: kmbRoutes, citybus: citybusRoutes };
  } catch (error) {
    console.error('Error fetching all routes:', error);
    return { kmb: [], citybus: [] };
  }
}

let selectedRoute = null;
let routeIdCounter = 0;

// Initialize date and day of week
document.addEventListener('DOMContentLoaded', function() {
  const today = new Date();
  const dateInput = document.getElementById('surveyDate');
  dateInput.valueAsDate = today;
  updateDayOfWeek();
  
  dateInput.addEventListener('change', updateDayOfWeek);
});

function updateDayOfWeek() {
  const dateInput = document.getElementById('surveyDate');
  const date = dateInput.valueAsDate;
  if (date) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = days[date.getDay()];
    document.getElementById('dayOfWeek').textContent = dayOfWeek;
  }
}

async function searchRoute() {
  const searchRoute = document.getElementById("routeInput").value.trim().toUpperCase();

  if (!searchRoute) {
    alert("Please enter a route number");
    return;
  }

  try {
    console.log("Searching for route:", searchRoute);
    
    if (!allRoutes) {
      allRoutes = await getAllRoutes();
    }
    
    const list = document.getElementById("routeList");
    list.innerHTML = "";
    let foundAny = false;

    // Search KMB routes
    const kmbMatches = allRoutes.kmb.filter(r => r.route === searchRoute);
    if (kmbMatches.length > 0) {
      foundAny = true;
      const heading = document.createElement("h4");
      heading.style.marginTop = "10px";
      heading.textContent = "KMB";
      list.appendChild(heading);
      
      kmbMatches.forEach(r => {
        const li = document.createElement("li");
        const text = `Route ${r.route} | ${r.dest_tc} (${r.dest_en}) | Service ${r.service_type}`;
        const routeId = routeIdCounter++;
        const btn = document.createElement("button");
        btn.textContent = text;
        btn.dataset.routeId = routeId;
        btn.onclick = function() { selectStoredRoute(routeId); };
        window[`route_${routeId}`] = r;
        li.appendChild(btn);
        list.appendChild(li);
      });
    }

    // Search Citybus routes
    const citybusMatches = allRoutes.citybus.filter(r => r.route === searchRoute);
    if (citybusMatches.length > 0) {
      foundAny = true;
      const heading = document.createElement("h4");
      heading.style.marginTop = "10px";
      heading.textContent = "Citybus (CTB)";
      list.appendChild(heading);
      
      citybusMatches.forEach(r => {
        // Outbound option (from orig to dest)
        const liOut = document.createElement("li");
        const textOut = `Route ${r.route} | ${r.orig_tc} → ${r.dest_tc} (Outbound)`;
        const routeIdOut = routeIdCounter++;
        const btnOut = document.createElement("button");
        btnOut.textContent = textOut;
        btnOut.dataset.routeId = routeIdOut;
        btnOut.onclick = function() { selectStoredRoute(routeIdOut); };
        window[`route_${routeIdOut}`] = { ...r, direction: "outbound" };
        liOut.appendChild(btnOut);
        list.appendChild(liOut);

        // Inbound option (from dest to orig)
        const liIn = document.createElement("li");
        const textIn = `Route ${r.route} | ${r.dest_tc} → ${r.orig_tc} (Inbound)`;
        const routeIdIn = routeIdCounter++;
        const btnIn = document.createElement("button");
        btnIn.textContent = textIn;
        btnIn.dataset.routeId = routeIdIn;
        btnIn.onclick = function() { selectStoredRoute(routeIdIn); };
        window[`route_${routeIdIn}`] = { ...r, direction: "inbound" };
        liIn.appendChild(btnIn);
        list.appendChild(liIn);
      });
    }

    if (!foundAny) {
      alert("No routes found for: " + searchRoute);
    }
    
    console.log(`Found ${kmbMatches.length} KMB and ${citybusMatches.length} Citybus route(s)`);
  } catch (error) {
    console.error("Error in searchRoute:", error);
    alert("Error searching for route: " + error.message + "\n\nCheck the browser console (F12) for details.");
  }
}

function selectRoute(routeObj) {
  console.log("Selected route:", routeObj);
  selectedRoute = routeObj;
  
  // Display route info in survey section
  const routeInfo = document.getElementById('selectedRouteInfo');
  const operator = routeObj.co === 'CTB' ? 'Citybus (CTB)' : (routeObj.co === 'KMB' ? 'KMB' : routeObj.co);
  routeInfo.textContent = `Route: ${routeObj.route} | Operator: ${operator}`;
  
  // Determine if it's KMB or Citybus based on the presence of service_type field
  if (routeObj.service_type !== undefined) {
    // KMB route
    loadKMBStops();
  } else if (routeObj.co === 'CTB') {
    // Citybus route
    loadCitybusStops();
  }
}

function selectStoredRoute(routeId) {
  const routeObj = window[`route_${routeId}`];
  selectRoute(routeObj);
}

function addRowEventListeners(row) {
  const inputs = row.querySelectorAll("input");
  const timeInput = inputs[0];
  const boardingInput = inputs[1];
  const alightingInput = inputs[2];
  const onboardInput = inputs[3];

  // Autofill time on first Boarding or Alighting entry
  function autoFillTime() {
    if (!timeInput.value && (boardingInput.value || alightingInput.value)) {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      timeInput.value = `${hours}:${minutes}`;
    }
  }

  boardingInput.addEventListener('change', autoFillTime);
  alightingInput.addEventListener('change', autoFillTime);

  // Autofill Onboard when edited or when boarding/alighting changes
  onboardInput.addEventListener('change', function() {
    // Clear autofilled flag when user manually enters a value
    delete this.dataset.autofilled;
    updateOnboardRow.call(this);
  });
  boardingInput.addEventListener('change', recalculateOnboardColumn);
  alightingInput.addEventListener('change', recalculateOnboardColumn);
}

function updateOnboardRow(event) {
  const row = event.target.closest('tr');
  if (!row) return;

  // Recalculate all onboard values using the edited value as the new reference
  recalculateOnboardColumn();
}

function recalculateOnboardColumn() {
  const tbody = document.getElementById("tableBody");
  const rows = Array.from(tbody.querySelectorAll("tr"));
  
  // First, clear any previously autofilled values (but keep manually entered ones)
  rows.forEach(row => {
    const inputs = row.querySelectorAll("input");
    const onboardInput = inputs[3];
    if (onboardInput.dataset.autofilled) {
      onboardInput.value = '';
      delete onboardInput.dataset.autofilled;
    }
  });
  
  // Find the LATEST manually-entered onboard value
  let referenceRowIndex = -1;
  let referenceOnboard = null;

  for (let i = rows.length - 1; i >= 0; i--) {
    const inputs = rows[i].querySelectorAll("input");
    const onboardInput = inputs[3];
    
    // Only use manually entered values (those without autofilled flag and not empty)
    if (onboardInput.value && onboardInput.value !== '') {
      referenceRowIndex = i;
      referenceOnboard = parseInt(onboardInput.value);
      break;
    }
  }

  // If no reference onboard entry found, don't autofill
  if (referenceRowIndex === -1 || referenceOnboard === null) {
    return;
  }

  // Calculate BACKWARDS from reference row to first stop with data
  let currentOnboard = referenceOnboard;
  for (let i = referenceRowIndex - 1; i >= 0; i--) {
    const inputs = rows[i].querySelectorAll("input");
    const boardingInput = inputs[1];
    const alightingInput = inputs[2];
    const onboardInput = inputs[3];

    const boarding = parseInt(boardingInput.value) || 0;
    const alighting = parseInt(alightingInput.value) || 0;

    // Only calculate if this row has boarding or alighting data
    if (boarding > 0 || alighting > 0) {
      // Reverse calculation: onboard_prev = onboard_current - boarding_current + alighting_current
      currentOnboard = currentOnboard - boarding + alighting;
      // Only autofill if not manually entered
      if (!onboardInput.value || onboardInput.value === '') {
        onboardInput.value = currentOnboard;
        onboardInput.dataset.autofilled = 'true';
      } else {
        // If manually entered, use it as new reference
        currentOnboard = parseInt(onboardInput.value);
      }
    }
  }

  // Calculate FORWARDS from reference row to last stop with data
  currentOnboard = referenceOnboard;
  for (let i = referenceRowIndex + 1; i < rows.length; i++) {
    const inputs = rows[i].querySelectorAll("input");
    const boardingInput = inputs[1];
    const alightingInput = inputs[2];
    const onboardInput = inputs[3];

    const boarding = parseInt(boardingInput.value) || 0;
    const alighting = parseInt(alightingInput.value) || 0;

    // Only calculate if this row has boarding or alighting data
    if (boarding > 0 || alighting > 0) {
      // Forward calculation: onboard_next = onboard_current + boarding_next - alighting_next
      currentOnboard = currentOnboard + boarding - alighting;
      // Only autofill if not manually entered
      if (!onboardInput.value || onboardInput.value === '') {
        onboardInput.value = currentOnboard;
        onboardInput.dataset.autofilled = 'true';
      } else {
        // If manually entered, use it as new reference
        currentOnboard = parseInt(onboardInput.value);
      }
    }
  }
}

function exportCSV() {
  const surveyerName = document.getElementById('surveyerName').value;
  const surveyDate = document.getElementById('surveyDate').value;
  const dayOfWeek = document.getElementById('dayOfWeek').textContent;
  const vehicleNumber = document.getElementById('vehicleNumber').value;
  const surveyNotes = document.getElementById('surveyNotes').value;

  const rows = document.querySelectorAll("#tableBody tr");

  let csv = "SURVEY INFORMATION\n";
  csv += `Surveyor Name,${escapeCsvField(surveyerName)}\n`;
  csv += `Date,${surveyDate}\n`;
  csv += `Day of Week,${dayOfWeek}\n`;
  csv += `Vehicle Number,${escapeCsvField(vehicleNumber)}\n`;
  
  // Add route and operator information
  if (selectedRoute) {
    const operator = selectedRoute.co === 'CTB' ? 'Citybus (CTB)' : (selectedRoute.co === 'KMB' ? 'KMB' : selectedRoute.co);
    csv += `Route,${selectedRoute.route}\n`;
    csv += `Operator,${operator}\n`;
  }
  
  csv += `Notes,${escapeCsvField(surveyNotes)}\n`;
  csv += "\n\nPASSENGER DATA\n";
  csv += "stop_tc,stop_en,time,boarding,alighting,onboard,cumulative_boarding,notes\n";

  // Find the first row with data to use as cumulative_boarding starting point
  let cumulativeBoarding = null;
  let isFirstDataRow = true;
  
  rows.forEach(row => {
    const cells = row.querySelectorAll("td");
    const inputs = row.querySelectorAll("input");

    const stopText = cells[0].innerText.split("\n");
    
    // Concatenate stop names and properly escape for CSV
    const stop_tc = escapeCsvField(stopText[0]);
    const stop_en = escapeCsvField(stopText[1]);

    const time = inputs[0].value;
    // Keep boarding and alighting as empty strings if not entered, instead of defaulting to 0
    const boardingInput = inputs[1].value;
    const alightingInput = inputs[2].value;
    const boarding = boardingInput ? parseInt(boardingInput) : 0;
    const alightingForDisplay = alightingInput || '';
    const boardingForDisplay = boardingInput || '';
    const onboard = inputs[3].value;
    const notes = escapeCsvField(inputs[4].value);

    let cumulativeBoardingValue = '';

    if (isFirstDataRow && (boarding > 0 || alightingInput || onboard)) {
      // First data row
      cumulativeBoarding = onboard ? parseInt(onboard) : 0;
      cumulativeBoardingValue = cumulativeBoarding;
      isFirstDataRow = false;

    } else if (cumulativeBoarding !== null) {
      // Subsequent rows: add CURRENT row's boarding first
      cumulativeBoarding += boarding;
      cumulativeBoardingValue = cumulativeBoarding;
    }

    csv += `${stop_tc},${stop_en},${time},${boardingForDisplay},${alightingForDisplay},${onboard},${cumulativeBoardingValue},${notes}\n`;
  });

  // Add UTF-8 BOM to ensure proper encoding of Chinese characters
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "bus_data.csv";
  a.click();
}

function escapeCsvField(field) {
  // Convert to string and handle null/undefined
  if (!field) return '';
  field = String(field);
  
  // If field contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}

async function uploadToDatabase(buttonElement) {
  // Validate route selection
  if (!selectedRoute) {
    alert('Please select a route first');
    return false;
  }

  // Get survey data (all fields are now optional)
  const surveyerName = document.getElementById('surveyerName').value || 'Unknown';
  const surveyDate = document.getElementById('surveyDate').value;
  const dayOfWeek = document.getElementById('dayOfWeek').textContent;
  const vehicleNumber = document.getElementById('vehicleNumber').value || 'N/A';
  const surveyNotes = document.getElementById('surveyNotes').value || '';
  const operator = selectedRoute.co === 'CTB' ? 'Citybus (CTB)' : (selectedRoute.co === 'KMB' ? 'KMB' : selectedRoute.co);

  // Get passenger data rows
  const rows = document.querySelectorAll('#tableBody tr');
  if (rows.length === 0) {
    alert('No passenger data to upload');
    return false;
  }

  // Collect passenger data
  const passengerLogs = [];
  let cumulativeBoarding = null;
  let survey_start_time = null;
  let survey_start = null;
  let survey_end = null;
  let isFirstDataRow = true;

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    const inputs = row.querySelectorAll('input');

    const stopText = cells[0].innerText.split('\n');
    const stop_tc = stopText[0];
    const stop_en = stopText[1];
    const time = inputs[0].value;
    const boardingInput = inputs[1].value;
    const alightingInput = inputs[2].value;
    const boarding = boardingInput ? parseInt(boardingInput) : 0;
    const alighting = alightingInput ? parseInt(alightingInput) : 0;
    const onboard = inputs[3].value ? parseInt(inputs[3].value) : 0;
    const notes = inputs[4].value;

    // Only include rows with data
    if (time || boarding > 0 || alighting > 0 || onboard > 0) {
      // For first data row, capture start information
      if (isFirstDataRow) {
        survey_start_time = time;
        survey_start = stop_tc;
        cumulativeBoarding = onboard || 0;
        isFirstDataRow = false;
      }
      
      // Update end information for each row (last row with data)
      survey_end = stop_tc;
      
      // Calculate cumulative boarding
      cumulativeBoarding = (cumulativeBoarding || 0) + boarding;

      passengerLogs.push({
        stop_tc,
        stop_en,
        stop_time: (time && time.trim() !== "") ? time : null,
        boarding: boarding > 0 ? boarding : null,
        alighting: alighting > 0 ? alighting : null,
        onboard: onboard > 0 ? onboard : null,
        total: cumulativeBoarding,
        notes: notes || null
      });
    }
  });

  if (passengerLogs.length === 0) {
    alert('No passenger data to upload');
    return false;
  }

  // Declare originalText OUTSIDE try-catch so it's available in catch block
  let originalText = '';
  if (buttonElement) {
    originalText = buttonElement.textContent;
  }

  try {
    // Show loading state
    if (buttonElement) {
      buttonElement.textContent = 'Uploading...';
      buttonElement.disabled = true;
    }

    // Insert survey data
    const { data: surveyData, error: surveyError } = await supabaseClient
      .from('surveys')
      .insert([
        {
          surveyor_name: surveyerName,
          survey_date: surveyDate || null,
          survey_day: dayOfWeek,
          operator,
          route: selectedRoute.route,
          survey_start_time: (survey_start_time && survey_start_time.trim() !== "") ? survey_start_time : null,
          survey_start: survey_start || null,
          survey_end: survey_end || null,
          vehicle_number: vehicleNumber,
          general_notes: surveyNotes || null
        }
      ])
      .select();

    if (surveyError) {
      throw new Error(`Survey insert error: ${surveyError.message}`);
    }

    const surveyId = surveyData[0].id;

    // Insert passenger logs
    const logsToInsert = passengerLogs.map(log => ({
      ...log,
      survey_id: surveyId
    }));

    const { error: logsError } = await supabaseClient
      .from('passenger_logs')
      .insert(logsToInsert);

    if (logsError) {
      throw new Error(`Passenger logs insert error: ${logsError.message}`);
    }

    // Success feedback
    if (buttonElement) {
      buttonElement.textContent = originalText;
      buttonElement.disabled = false;
    }
    alert(`Survey uploaded successfully!\nSurvey ID: ${surveyId}\nPassenger entries: ${passengerLogs.length}`);
    return true;

  } catch (error) {
    console.error('Upload error:', error);
    if (buttonElement) {
      buttonElement.textContent = originalText;
      buttonElement.disabled = false;
    }
    alert(`Upload failed: ${error.message}\n\nPlease check the browser console (F12) for details.`);
    return false;
  }
}

async function uploadAndDownloadCSV(buttonElement) {
  const success = await uploadToDatabase(buttonElement);
  if (success) {
    // Small delay to let user see the success message
    setTimeout(() => {
      exportCSV();
    }, 500);
  }
}