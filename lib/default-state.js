export function defaultState(){
  const createdAt=new Date().toISOString();
  return {
    version:6,
    accounts:[
      {id:'acc_main',name:'Genel Kasa',type:'wallet',bankName:'Enpara',iban:'',createdAt},
      {id:'acc_yusuf',name:'Yusuf Cari',type:'current',owner:'Yusuf',bankName:'',iban:'',createdAt},
      {id:'acc_taha',name:'Taha Cari',type:'current',owner:'Taha',bankName:'',iban:'',createdAt},
      {id:'acc_omer',name:'Ömer Cari',type:'current',owner:'Ömer',bankName:'',iban:'',createdAt}
    ],
    transactions:[],
    prices:{'FX:USD':0,'FX:EUR':0,'GOLD:GRAM':0},
    priceNames:{'FX:USD':'USD/TL','FX:EUR':'EUR/TL','GOLD:GRAM':'Gram Altın'},
    debtPlans:[],paymentClaims:[],notifications:[],settings:{debtDueDay:5}
  }
}
