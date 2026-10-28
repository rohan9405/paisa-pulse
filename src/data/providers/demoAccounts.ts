import type {Account,Transaction} from '@/lib/types';
export function demoAccounts(now=Date.now()):Account[]{return[
 {id:'HDFC-account-4821',bank:'HDFC',last4:'4821',kind:'account',balancePaise:93200_00,asOf:now,ownerConfirmed:true,balanceKnown:true,balanceSource:'sms'},
 {id:'ICICI-account-9036',bank:'ICICI',last4:'9036',kind:'account',balancePaise:20000_00,asOf:now-3*86400000,ownerConfirmed:true,balanceKnown:true,balanceSource:'sms'},
 {id:'Axis-card-6412',bank:'Axis',last4:'6412',kind:'card',balancePaise:84800_00,asOf:now,ownerConfirmed:true,balanceKnown:true,balanceSource:'sms'},
 {id:'SBI-account-1144',bank:'SBI',last4:'1144',kind:'account',balancePaise:0,asOf:0,ownerConfirmed:true,balanceKnown:false},
];}
/** Explicit fictional routing for demo examples only, never used for personal records. */
export function assignDemoAccount(t:Transaction,index:number):Transaction{return{...t,accountId:t.accountId??(t.method==='card'?'Axis-card-6412':t.kind==='income'||index%2===0?'HDFC-account-4821':'ICICI-account-9036'),direction:t.direction??(['income','refund','settlement'].includes(t.kind)?'in':'out')};}
