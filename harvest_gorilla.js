const Web3 = require("web3");
const puppeteer = require('puppeteer');
const abiDecoder = require('abi-decoder');
const Common = require('ethereumjs-common');
const solc = require("solc");
const Tx = require('ethereumjs-tx')
const fs = require('fs');
let rawdata = fs.readFileSync('wallet_gorilla.json');
const wallet = JSON.parse(rawdata);
const rpcAddress = wallet.rpc;
const account = wallet.account;
const key = Buffer.from(wallet.key, "hex");
const web3 = new Web3(new Web3.providers.HttpProvider(wallet.rpc));
var abi = wallet.contractABI;
const maticAddress = wallet.matic;
var maticContract = new web3.eth.Contract(abi, maticAddress);
var toContract = new web3.eth.Contract(abi, wallet.toContract);
var farmMCabi = wallet.farmMCabi;
var stakingAdd = wallet.farmMCAdd;
stakingContract = new web3.eth.Contract(farmMCabi, stakingAdd);
var poolIDS = [];
var farmTokenAdd = wallet.farmTokenAdd;
var farmTokenAbi = wallet.contractABI;
var farmTokenContact = new web3.eth.Contract(farmTokenAbi, farmTokenAdd);
var qsRouterAdd = wallet.qsRouterAdd;
var qsRouterABI = wallet.qsRouterABI;
var qsRouter = new web3.eth.Contract(qsRouterABI, qsRouterAdd, { from: account });
var farmDecimal = 18;
var maticDecimal = 18;
var harvestThreshold = wallet.harvestThreshold;
var sellThreshold = wallet.sellThreshold;
async function contractInfo() {
	var count = await web3.eth.getTransactionCount(account,'pending');
		count = count ;
        console.log(count);
		
    try {
		console.log(wallet.pooledTokens.length);
		var name = await farmTokenContact.methods.name().call();
        console.log('The token name is: ' + name);
		 name = await toContract.methods.name().call();
        console.log('The token name is: ' + name);
        farmDecimal = await farmTokenContact.methods.decimals().call();
        console.log('The token decimal is: ' + farmDecimal);
        maticDecimal = await maticContract.methods.decimals().call();
        console.log('The token decimal is: ' + maticDecimal);
        for (var p = 0; p < 35; p++) {
            try {
                var pid = await stakingContract.methods.poolInfo(p).call();
                console.log(pid.lpToken);
                if (!pid) continue;
				poolIDS.push(p);
                // for (var i = 0; i < wallet.pooledTokens.length; i++) {
                    // if (pid.lpToken.trim().toLowerCase() === wallet.pooledTokens[i].trim().toLowerCase()) {
                        // poolIDS.push(p);
                    // }
                // }
            } catch (ex) {
                //console.log(ex)
            }
        }
        console.log(poolIDS);
        harvest();
    } catch (ex) {
        console.log(ex)
    }
}
async function harvest() {
	try{
	var count = await web3.eth.getTransactionCount(account,'pending');
		count = count ;
        console.log(count);
	var fDec = parseInt(farmDecimal)+2 ;
	console.log(fDec);
    var tokenHarvestThreshold = 0;
    var tokenSellThreshold = 0;
    var price = await getPrice(1, maticAddress);
    tokenHarvestThreshold = harvestThreshold / price[2];
    tokenHarvestThreshold = getWeiTokens(farmDecimal, tokenHarvestThreshold);
    tokenSellThreshold = getWeiTokens(farmDecimal, sellThreshold / price[2]);
    console.log(getReverseWeiTokens(tokenHarvestThreshold,farmDecimal).toFixed(fDec),
	getReverseWeiTokens(tokenSellThreshold,farmDecimal).toFixed(fDec)	);
    for (var i = 0; i < poolIDS.length; i++) {
        try {
            var poolId = poolIDS[i];
            var pendingBone = await stakingContract.methods.pendingGorilla(poolId, account).call();
            console.log("pendingGorilla - " + getReverseWeiTokens(pendingBone,farmDecimal).toFixed(fDec));
            if (pendingBone > tokenHarvestThreshold) {
                console.log("Harvesting for - " + poolId + " - " + pendingBone);
                await sendHarvest(poolId);
            }
            //var data = await stakingContract.methods.deposit(poolId,0);
        } catch (ex) {
            console.log(ex);
        }
    }
    try {
        var balance = await farmTokenContact.methods.balanceOf(account).call();
        console.log("Balance " + balance, getReverseWeiTokens(balance,farmDecimal).toFixed(fDec));
        if (balance > tokenSellThreshold) {
            var allowanceResult = await checkAndApprove(farmTokenContact, farmTokenAdd,
                qsRouterAdd, balance);
            if (!allowanceResult) return { "approval": allowanceResult };
            price = await getPrice(balance,wallet.toContract);
            console.log(price);
            var buyResult = await sendBuy(balance, price[1], wallet.toContract);
        }
    } catch (ex) {
        console.log(ex);
    }
	}
	catch(ex)
	{
		console.log(ex);
	}
    setTimeout(function() {
        harvest();
    }, wallet.delayBetweenHarvests * 1000);
}
async function sendHarvest(poolId) {
	try{
    var data = stakingContract.methods.withdraw(
        web3.utils.toHex(poolId), web3.utils.toHex(0));
    console.log("signing tx");
    var result = await sendTransaction(stakingAdd, data,
        web3.utils.toHex(0));
	}
	catch(ex)
	{
		console.log(ex);
	}
}
async function checkAndApprove(contract, contractAddress, qsRouterAdd, amount) {
    try {
        var allowance = await contract.methods.allowance(account, qsRouterAdd).call();
        if (allowance) {
            console.log('Allowance for contract is ' + allowance);
            console.log('Allowance required is ' + amount);
            if(allowance <= amount)
            {
				// var data = contract.methods.approve(qsRouterAdd, amount*2);
				// await sendTransaction(contractAddress,data,web3.utils.toHex(0));
            }
            return true;
        } else {
            return false;
        }
    } catch (e) {
        console.log(e);
        return false;
    }
}
async function getPrice(inToken, toToken) {
    if (inToken == 0) return [0, 0, 0];
    var amount = await qsRouter.methods.getAmountsOut(inToken, [farmTokenAdd, toToken]).call();
    if (!amount) {
        return false;
    }
    var invPrice = parseFloat(amount[1]) / parseFloat(formatTokens(amount[0], Math.abs(farmDecimal - maticDecimal)));
    var price = parseFloat(formatTokens(amount[0], Math.abs(farmDecimal - maticDecimal))) / parseFloat(amount[1]);
    var inAmount = getWeiTokens(farmDecimal, parseFloat(amount[0]));
    var outOgAmount = parseFloat(amount[1]);
    console.log("Price " + price + " Gorilla = 1 matic");
    console.log("Price " + invPrice + " matic = 1 Gorilla");
    var outAmount = outOgAmount;
    outAmount = Math.floor((outAmount - (outAmount * 25 / 100))); //*Math.pow(10,contractPairDecimal);
    return [inAmount, outAmount, outOgAmount];
}

function formatTokens(balance, decimals) {
    if (!balance || balance == 0) return 0;
    return balance * Math.pow(10, decimals);
}

function getReverseWeiTokens(balance, decimals) {
    if (!balance || balance == 0) return 0;
    return balance / Math.pow(10, decimals)
}

function getWeiTokens(decimals, balance) {
    if (!balance || balance == 0) return 0;
    return balance * Math.pow(10, decimals)
}

function getTime() {
    var currentdate = new Date();
    var datetime = currentdate.getHours() + ":" +
        currentdate.getMinutes() + ":" +
        currentdate.getSeconds();
    return datetime + " - ";
}
async function sendBuy(inAmount, outAmount, toContract) {
    console.log(inAmount, outAmount);
    var data = qsRouter.methods.swapExactTokensForTokens(
        web3.utils.toHex(inAmount),
        web3.utils.toHex(outAmount),
        [farmTokenAdd, toContract],
        account,
        web3.utils.toHex(Math.round(Date.now() / 1000) + 60 * 10),
    );
    console.log(Math.round(Date.now() / 1000) + 60 * 10);
    console.log("signing tx");
    var result = await sendTransaction(qsRouterAdd, data,
        web3.utils.toHex(0));
    return result;
}
var nonce = wallet.nonce;
async function sendTransaction(toAddress, data, amountToBuyWith) {
    try {
		var count = await web3.eth.getTransactionCount(account,'pending');
		if(count < nonce)
		{
			count = nonce;
			nonce++;			
		}
		
        console.log(count);
        var gasPrice = await web3.eth.getGasPrice();
		var gwei = wallet.gwei; 
        console.log((count) + " " + gwei + " " + gasPrice +
            " " + Math.ceil(gasPrice * gwei));
        var rawTransaction = {
            "from": account,
            "gasPrice": web3.utils.toHex(Math.ceil(gasPrice * gwei)),
            "gasLimit": web3.utils.toHex(wallet.gas), //+Math.random().toString().slice(2,7)),
            "to": toAddress,
            "value": web3.utils.toHex(amountToBuyWith),
            "data": data.encodeABI(),
            "nonce": web3.utils.toHex(count)
        };
        const common1 = Common.default.forCustomChain(
            'mainnet', {
                name: 'matic',
                networkId: 137,
                chainId: 137
            },
            'petersburg'
        )
        var transaction = new Tx.Transaction(rawTransaction, { common: common1 });
        transaction.sign(key);
        console.log(transaction.hash(true).toString('hex'));
        console.log(getTime() + "sending tx");
        var result = await web3.eth.sendSignedTransaction('0x' + transaction.serialize().toString('hex'));
        console.log(getTime() + result.status + " - " + result.transactionHash)
        return result;
    } catch (e) {
        console.log(e);
    }
    return false;
}
contractInfo();