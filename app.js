/* ═══════════════════════════════════════════════════════════
   SHRISTI ENTERPRISES — Core Application Engine
   Database · Auth · AWB · Rates · Shipments · Utilities
   Domain: shristi.enterprises
═══════════════════════════════════════════════════════════ */
'use strict';

/* ── DATABASE ── */
const DB = {
  P: 'se_',
  get(col)    { try { return JSON.parse(localStorage.getItem(this.P+col)||'[]'); } catch(e){ return []; } },
  getObj(k)   { try { return JSON.parse(localStorage.getItem(this.P+k)||'null'); } catch(e){ return null; } },
  set(col,d)  { localStorage.setItem(this.P+col, JSON.stringify(d)); },
  setObj(k,v) { localStorage.setItem(this.P+k, JSON.stringify(v)); },
  uid()       { return 'SE'+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,5).toUpperCase(); },

  insert(col, item) {
    const d = this.get(col);
    item.id = this.uid();
    item.createdAt = new Date().toISOString();
    item.updatedAt = new Date().toISOString();
    d.push(item); this.set(col, d); return item;
  },
  update(col, id, changes) {
    const d = this.get(col), i = d.findIndex(x=>x.id===id);
    if(i===-1) return null;
    d[i] = {...d[i], ...changes, updatedAt: new Date().toISOString()};
    this.set(col, d); return d[i];
  },
  remove(col, id) { this.set(col, this.get(col).filter(x=>x.id!==id)); },
  findOne(col, fn) { return this.get(col).find(fn)||null; },
  find(col, fn)   { const d=this.get(col); return fn?d.filter(fn):d; },
  count(col, fn)  { return this.find(col,fn).length; },
  sum(col, field, fn) { return this.find(col,fn).reduce((a,x)=>a+(+x[field]||0),0); }
};

/* ── AUTH ── */
const Auth = {
  SK: 'se_session',
  hash(p)  { return btoa(unescape(encodeURIComponent(p+'_shristi2025'))); },

  register(data) {
    if(DB.findOne('users', u=>u.email.toLowerCase()===data.email.toLowerCase()))
      return { error: 'Email already registered.' };
    return DB.insert('users', {
      name: data.name, email: data.email.toLowerCase(),
      passwordHash: this.hash(data.password),
      phone: data.phone||'', company: data.company||'',
      gst: data.gst||'', pan: data.pan||'',
      role: data.role||'customer',           // admin | corporate | customer
      accountType: data.accountType||'prepaid', // prepaid | credit
      creditLimit: +data.creditLimit||0, creditUsed: 0,
      active: true, kycVerified: false,
      billingAddress: data.billingAddress||{},
      pickupAddress: data.pickupAddress||{},
      employeeCount: 0, parentId: data.parentId||null,
      lastLoginAt: null
    });
  },

  login(email, password) {
    const u = DB.findOne('users', u=>
      u.email===email.toLowerCase() && u.passwordHash===this.hash(password) && u.active!==false);
    if(!u) return null;
    sessionStorage.setItem(this.SK, JSON.stringify({uid:u.id, role:u.role, ts:Date.now()}));
    DB.update('users', u.id, {lastLoginAt: new Date().toISOString()});
    return this.strip(u);
  },

  logout() { sessionStorage.removeItem(this.SK); location.href='login.html'; },

  me() {
    try {
      const s = JSON.parse(sessionStorage.getItem(this.SK));
      if(!s) return null;
      const u = DB.findOne('users', u=>u.id===s.uid);
      return (u && u.active) ? this.strip(u) : null;
    } catch(e){ return null; }
  },

  strip(u) { const {passwordHash,...rest}=u; return rest; },

  guard(roles=[]) {
    const u = this.me();
    if(!u){ location.href='login.html'; return null; }
    if(roles.length && !roles.includes(u.role)){ location.href='dashboard.html'; return null; }
    return u;
  }
};

/* ── AWB GENERATION ── */
const AWB = {
  PFX: {dtdc:'DT',maruti:'MR',bluedart:'BD',delhivery:'DL'},
  generate(carrier) {
    const p = this.PFX[carrier]||'SE';
    return p + Date.now().toString().slice(-8) + String(Math.floor(Math.random()*900)+100);
  },
  internal() { return 'SHR'+Date.now().toString().slice(-9); }
};

/* ── RATE ENGINE ── */
const Rates = {
  ZONES: {
    'Mumbai':'A','Thane':'A','Navi Mumbai':'A','Pune':'A','Nashik':'A','Aurangabad':'A',
    'Ahmedabad':'A','Surat':'A','Vadodara':'A','Rajkot':'A','Gandhinagar':'A',
    'Delhi':'B','Noida':'B','Gurgaon':'B','Faridabad':'B','Ghaziabad':'B',
    'Bengaluru':'B','Chennai':'B','Hyderabad':'B','Jaipur':'B','Lucknow':'B',
    'Kanpur':'B','Nagpur':'B','Indore':'B','Bhopal':'B','Coimbatore':'B',
    'Kochi':'B','Chandigarh':'B','Ludhiana':'B','Amritsar':'B',
    'Kolkata':'C','Patna':'C','Ranchi':'C','Bhubaneswar':'C','Raipur':'C',
    'Dehradun':'C','Jodhpur':'C','Udaipur':'C','Visakhapatnam':'C','Vijayawada':'C',
    'Guwahati':'D','Shillong':'D','Agartala':'D','Jammu':'D','Srinagar':'D',
    'Imphal':'D','Aizawl':'D','Kohima':'D','Itanagar':'D','Gangtok':'D'
  },
  BASE: {
    dtdc:      {A:50,  B:68,  C:88,  D:115},
    maruti:    {A:40,  B:55,  C:72,  D:95},
    bluedart:  {A:85,  B:110, C:140, D:175},
    delhivery: {A:48,  B:64,  C:84,  D:108}
  },
  KG: {
    dtdc:      {A:14, B:20, C:26, D:35},
    maruti:    {A:11, B:16, C:21, D:28},
    bluedart:  {A:20, B:28, C:36, D:48},
    delhivery: {A:13, B:18, C:23, D:31}
  },
  FUEL: 0.12,  // 12% fuel surcharge

  calc(carrier, toCity, kg, insure=0, cod=0) {
    const z   = this.ZONES[toCity]||'C';
    const base = this.BASE[carrier]?.[z]||90;
    const perKg= this.KG[carrier]?.[z]||22;
    const addKg= Math.max(0, kg-0.5);
    let sub = base + addKg*perKg;
    sub += sub * this.FUEL;
    const ins = insure>0 ? Math.max(25, Math.round(insure*0.012)) : 0;
    const codChg = cod>0 ? Math.max(35, Math.round(cod*0.018)) : 0;
    sub = Math.round(sub);
    const gst = Math.round((sub+ins+codChg)*0.18);
    return { zone:z, base:Math.round(base), weightChg:Math.round(addKg*perKg),
             fuel:Math.round((base+addKg*perKg)*this.FUEL),
             insurance:ins, codCharge:codChg,
             subtotal:sub+ins+codChg, gst, total:sub+ins+codChg+gst, carrier };
  },

  compare(toCity, kg) {
    return ['dtdc','maruti','bluedart','delhivery']
      .map(c=>({carrier:c,...this.calc(c,toCity,kg)}))
      .sort((a,b)=>a.total-b.total);
  }
};

/* ── SHIPMENT ENGINE ── */
const Ship = {
  STATUSES: ['booked','pickup_scheduled','picked_up','in_transit','out_for_delivery','delivered','failed_delivery','rto_initiated','rto_delivered','cancelled'],
  LABELS: {
    booked:'Booked', pickup_scheduled:'Pickup Scheduled', picked_up:'Picked Up',
    in_transit:'In Transit', out_for_delivery:'Out for Delivery', delivered:'Delivered',
    failed_delivery:'Delivery Failed', rto_initiated:'RTO Initiated',
    rto_delivered:'RTO Delivered', cancelled:'Cancelled'
  },

  create(data, user) {
    const awb   = AWB.generate(data.carrier);
    const rates = Rates.calc(data.carrier, data.toCity, +data.weight, +data.insuredValue||0, data.isCOD?(+data.codAmount||0):0);
    return DB.insert('shipments', {
      awb, internalRef: AWB.internal(),
      userId: user.id, userName: user.name, company: user.company||'',
      carrier: data.carrier, service: data.service||'standard',
      // Sender
      sFrom:  data.sFrom||user.name, sPhone: data.sPhone||user.phone,
      sAddr:  data.sAddr||'', sCity: data.sCity||'Mumbai', sPin: data.sPin||'400093',
      sState: data.sState||'Maharashtra',
      // Receiver
      rName:  data.rName, rPhone: data.rPhone,
      rAddr:  data.rAddr, rCity: data.rCity, rPin: data.rPin, rState: data.rState||'',
      // Package
      weight: +data.weight, length: +data.length||0, breadth: +data.breadth||0, height: +data.height||0,
      desc: data.desc||'General Parcel', pieces: +data.pieces||1,
      // Financial
      insuredValue: +data.insuredValue||0,
      isCOD: !!data.isCOD, codAmount: data.isCOD?(+data.codAmount||0):0,
      rates, invoicePaid: false,
      // Status
      status: 'booked', events: [{
        status:'booked', label:'Shipment Booked',
        loc:'Andheri East, Mumbai', note:'Booked via Shristi Enterprises',
        ts: new Date().toISOString(), by:'system'
      }],
      // Dates
      pickupDate: data.pickupDate||null, estDelivery: null,
      deliveredAt: null, attemptCount: 0,
      // Meta
      bulkOrderId: data.bulkOrderId||null, remarks: data.remarks||'',
      podUrl: null, tags: data.tags||[]
    });
  },

  addEvent(id, status, loc, note, by='admin') {
    const s = DB.findOne('shipments', x=>x.id===id);
    if(!s) return null;
    const ev = { status, label: this.LABELS[status]||status, loc, note, ts: new Date().toISOString(), by };
    const upd = { status, events: [...(s.events||[]), ev] };
    if(status==='delivered') { upd.deliveredAt = new Date().toISOString(); upd.invoicePaid = true; }
    return DB.update('shipments', id, upd);
  },

  byAWB(awb)       { return DB.findOne('shipments', s=>s.awb===awb||s.internalRef===awb); },
  byUser(uid)      { return DB.find('shipments', s=>s.userId===uid).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)); },
  all()            { return DB.get('shipments').sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)); }
};

/* ── BULK ORDER ENGINE ── */
const Bulk = {
  create(rows, user) {
    const orderId = 'BO'+Date.now().toString().slice(-8);
    const ships = [];
    rows.forEach(r => {
      try { ships.push(Ship.create({...r, bulkOrderId: orderId}, user)); } catch(e){}
    });
    DB.insert('bulkorders', {
      orderId, userId: user.id, userName: user.name,
      count: ships.length, awbs: ships.map(s=>s.awb),
      totalCost: ships.reduce((a,s)=>a+(s.rates?.total||0),0),
      status: 'processed'
    });
    return { orderId, ships };
  }
};

/* ── INVOICE ENGINE ── */
const Invoice = {
  generate(shipments, user) {
    const invNo = 'INV'+new Date().getFullYear()+String(DB.count('invoices')+1).padStart(5,'0');
    const sub   = shipments.reduce((a,s)=>a+(s.rates?.subtotal||0),0);
    const gst   = shipments.reduce((a,s)=>a+(s.rates?.gst||0),0);
    return DB.insert('invoices', {
      invoiceNo: invNo, userId: user.id, userName: user.name,
      company: user.company||'', gst: user.gst||'',
      shipmentIds: shipments.map(s=>s.id), awbs: shipments.map(s=>s.awb),
      subtotal: sub, gstAmount: gst, total: sub+gst,
      status: 'unpaid', dueDate: new Date(Date.now()+30*864e5).toISOString()
    });
  }
};

/* ── UTILITIES ── */
const U = {
  fmtDate(iso) { if(!iso) return '—'; return new Date(iso).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}); },
  fmtDT(iso)   { if(!iso) return '—'; return new Date(iso).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); },
  fmtTime(iso) { if(!iso) return '—'; return new Date(iso).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}); },
  inr(n)       { return '₹'+Number(n||0).toLocaleString('en-IN'); },
  cap(s)       { return s?s.charAt(0).toUpperCase()+s.slice(1).replace(/_/g,' '):s; },

  statusColor(s) {
    return {booked:'#2563EB',pickup_scheduled:'#7C3AED',picked_up:'#0891B2',
      in_transit:'#D97706',out_for_delivery:'#EA580C',delivered:'#059669',
      failed_delivery:'#DC2626',rto_initiated:'#BE185D',rto_delivered:'#6B7280',
      cancelled:'#94A3B8'}[s]||'#64748B';
  },
  statusBg(s) {
    return {booked:'#EFF6FF',pickup_scheduled:'#F5F3FF',picked_up:'#ECFEFF',
      in_transit:'#FFFBEB',out_for_delivery:'#FFF7ED',delivered:'#ECFDF5',
      failed_delivery:'#FEF2F2',rto_initiated:'#FDF2F8',rto_delivered:'#F9FAFB',
      cancelled:'#F8FAFC'}[s]||'#F8FAFC';
  },
  carrierName(c)  { return {dtdc:'DTDC Express',maruti:'Maruti Courier',bluedart:'BlueDart Express',delhivery:'Delhivery'}[c]||c; },
  carrierColor(c) { return {dtdc:'#DC2626',maruti:'#D97706',bluedart:'#1D4ED8',delhivery:'#EA580C'}[c]||'#64748B'; },
  carrierBg(c)    { return {dtdc:'#FEF2F2',maruti:'#FFFBEB',bluedart:'#EFF6FF',delhivery:'#FFF7ED'}[c]||'#F8FAFC'; },

  trackURL(carrier, awb) {
    const urls = {
      dtdc:     awb=>`https://www.dtdc.com/track-your-shipment/?shipmentNumber=${awb}`,
      maruti:   awb=>`https://www.maruticourier.com/track-your-consignment/?awb=${awb}`,
      bluedart: awb=>`https://www.bluedart.com/web/guest/trackdartresult?trackFor=0&trackNo=${awb}`,
      delhivery:awb=>`https://www.delhivery.com/tracking/?wbn=${awb}`
    };
    return urls[carrier]?.(awb)||'#';
  },

  csvTemplate() {
    return 'Receiver Name,Phone,Address,City,PIN,State,Weight(kg),Length(cm),Breadth(cm),Height(cm),Pieces,Description,Declared Value,Is COD (yes/no),COD Amount,Carrier (dtdc/maruti/bluedart/delhivery),Service (standard/express),Remarks\n'+
      'Rahul Sharma,9876543210,"123 Main St",Delhi,110001,Delhi,1.5,20,15,10,1,Documents,500,no,0,dtdc,standard,Handle with care\n'+
      'Priya Singh,8765432109,"456 MG Road",Bengaluru,560001,Karnataka,2,25,20,15,1,Books,1500,yes,1500,delhivery,standard,';
  },

  downloadCSV(name, content) {
    const b = new Blob([content],{type:'text/csv'});
    const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(b),download:name});
    a.click(); URL.revokeObjectURL(a.href);
  },

  toast(msg, type='success') {
    const t = document.getElementById('toast');
    if(!t) return;
    t.textContent = msg;
    t.className = 'toast show '+(type==='error'?'toast-error':type==='info'?'toast-info':'toast-success');
    clearTimeout(t._tid);
    t._tid = setTimeout(()=>t.className='toast',3500);
  },

  ago(iso) {
    const d = Date.now()-new Date(iso).getTime();
    if(d<60000) return 'just now';
    if(d<3600000) return Math.floor(d/60000)+'m ago';
    if(d<86400000) return Math.floor(d/3600000)+'h ago';
    return Math.floor(d/86400000)+'d ago';
  }
};

/* ── SEED DEMO DATA ── */
(function seed(){
  if(DB.get('users').length) return;

  // Admin
  Auth.register({name:'Shristi Admin',email:'admin@shristi.enterprises',password:'Admin@2025',
    phone:'8286361223',company:'Shristi Enterprises',gst:'27BLGPC8230C1ZJ',role:'admin',accountType:'credit'});

  // Corporate
  const corp = Auth.register({name:'Rahul Kapoor',email:'corp@finserv.com',password:'Corp@2025',
    phone:'9876543210',company:'FinServ Corp Ltd',gst:'27AAACF1234M1ZA',
    role:'corporate',accountType:'credit',creditLimit:100000});
  DB.update('users',corp.id,{kycVerified:true,creditUsed:14500});

  // Corporate employee
  Auth.register({name:'Ananya Sharma',email:'employee@finserv.com',password:'Emp@2025',
    phone:'9123456780',company:'FinServ Corp Ltd',role:'customer',
    accountType:'credit',parentId:corp.id});

  // Individual
  Auth.register({name:'Priya Mehta',email:'priya@example.com',password:'Cust@2025',
    phone:'8765432109',company:'',role:'customer',accountType:'prepaid'});

  // Sample shipments
  const carriers=['dtdc','maruti','bluedart','delhivery'];
  const cities=['Delhi','Bengaluru','Pune','Chennai','Hyderabad','Kolkata','Ahmedabad','Jaipur','Lucknow','Surat'];
  const statuses=['in_transit','in_transit','out_for_delivery','delivered','delivered','picked_up','booked'];
  const rcvrs=[
    {rName:'Amit Shah',rPhone:'9111111111',rAddr:'12 Nehru Nagar'},
    {rName:'Sunita Rao',rPhone:'9222222222',rAddr:'34 MG Road'},
    {rName:'Vikram Nair',rPhone:'9333333333',rAddr:'56 Brigade Rd'},
    {rName:'Kavya Patel',rPhone:'9444444444',rAddr:'78 Civil Lines'},
    {rName:'Suresh Kumar',rPhone:'9555555555',rAddr:'90 Lal Bagh'},
  ];
  const corpUser = {...DB.findOne('users',u=>u.email==='corp@finserv.com')};
  const custUser = {...DB.findOne('users',u=>u.email==='priya@example.com')};

  for(let i=0;i<25;i++){
    const carrier  = carriers[i%4];
    const city     = cities[i%10];
    const status   = statuses[i%7];
    const rcv      = rcvrs[i%5];
    const wt       = +(0.5+Math.random()*4.5).toFixed(1);
    const val      = Math.floor(Math.random()*8000+500);
    const isCOD    = i%5===0;
    const user     = i<18 ? corpUser : custUser;

    const s = Ship.create({
      carrier, service: i%3===0?'express':'standard',
      sFrom:'Shristi Enterprises', sPhone:'8286361223',
      sAddr:'Gala No.06, Rainbow Industrial Estate, MIDC',
      sCity:'Mumbai', sPin:'400093', sState:'Maharashtra',
      toCity:city, weight:wt, length:20, breadth:15, height:10, pieces:1,
      desc:['Documents','Electronics','Clothing','Books','Medicine'][i%5],
      insuredValue:val, isCOD, codAmount:isCOD?val:0,
      rName:rcv.rName, rPhone:rcv.rPhone, rAddr:rcv.rAddr,
      rCity:city, rPin:'110001', rState:'Various', remarks:''
    }, user);

    // Age the shipment
    const dAgo = Math.floor(Math.random()*30)+1;
    const past = new Date(Date.now()-dAgo*864e5).toISOString();
    DB.update('shipments',s.id,{createdAt:past,updatedAt:past});

    // Advance status
    const flow=['booked','picked_up','in_transit','out_for_delivery','delivered'];
    const target = flow.indexOf(status);
    flow.slice(1, target+1).forEach((st,j)=>{
      Ship.addEvent(s.id, st, st==='picked_up'?'Andheri East, Mumbai':city+' Hub',
        st==='delivered'?'Delivered to '+rcv.rName:'Updated status');
    });
  }
  console.log('✓ Shristi Enterprises: Demo data ready');
})();
