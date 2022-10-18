import React, { useReducer, useEffect } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { useLocation } from "react-router-dom";
import types from "../data/types.json";

// ! State when coming into the app fresh
const initialState = {
  account: "",
  discordUrl:
    "https://discord.com/api/oauth2/authorize?client_id=1019447189027688449&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2F&response_type=code&scope=identify",
  discordConnected: false,
  discordCode: "",
  twitterStepOne: "https://a649f2fcca94.au.ngrok.io/oauth1/twitter/token",
  twitterStepThree: "https://a649f2fcca94.au.ngrok.io/oauth/verify",
  twitterUrl: "",
  twitterConnected: false,
  twitterLoginToken: "",
  twitterLoginVerifier: "",
  metamaskConnected: false,
  spinner: false,
  whitelisted: null,
  discordUserName: "",
  twitterUserName: "",
  submitURL: "https://a649f2fcca94.au.ngrok.io/submit",
  claimURL: "https://a649f2fcca94.au.ngrok.io/claim?username=",
  twitterId: "",
  discordRefreshToken: "",
  submitted: null,
  whitelisted_two: false,
  verified: null,
  pathTwo: false,
  image: null,
  clicked: false,
  error: "",
};

function reducer(state, action) {
  switch (action.type) {
    case types.RESET_STATE:
      return initialState;
    case types.SET_ACCOUNT:
      return {
        ...state,
        account: action.payload.account,
        metamaskConnected: true,
      };
    case types.DISCORD_CONNECTED:
      return {
        ...state,
        discordCode: action.payload.discordCode,
        discordConnected: true,
      };
    case types.SET_TWITTER_CONNECT_URL:
      return {
        ...state,
        twitterUrl: action.payload,
      };
    case types.TWITTER_CONNECTED:
      return {
        ...state,
        twitterLoginToken: action.payload.twitterLoginToken,
        twitterLoginVerifier: action.payload.twitterLoginVerifier,
        twitterConnected: true,
      };
    case types.WHITELISTED:
      return {
        ...state,
        whitelisted: action.payload.whitelisted,
        discordUserName: action.payload.discordUserName,
        twitterUserName: action.payload.twitterUserName,
        twitterId: action.payload.twitterId,
        discordRefreshToken: action.payload.discordRefreshToken,
        verified: action.payload.verified,
      };
    case types.SPIN: {
      return {
        ...state,
        spinner: true,
      };
    }
    case types.DONE_SPINNING:
      return {
        ...state,
        spinner: false,
      };
    case types.CLICKED:
      return { ...state, clicked: true };
    case types.SET_IMAGE:
      return { ...state, image: action.payload.image };
    case types.PATH_TWO:
      return { ...state, pathTwo: true };
    case types.WHITELISTED_TWO:
      return {
        ...state,
        whitelisted_two: action.payload.whitelisted_two,
        twitterUserName: action.payload.twitterUserName,
      };
    case types.SUBMITTED:
      return { ...state, submitted: action.payload.submitted };
    case types.ERROR:
      return { ...state, error: action.payload, showUI: true };
    default:
      throw new Error();
  }
}

const SSOButtons = () => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const {
    account,
    discordUrl,
    discordConnected,
    discordCode,
    twitterStepOne,
    twitterUrl,
    twitterStepThree,
    twitterConnected,
    twitterLoginToken,
    twitterLoginVerifier,
    metamaskConnected,
    whitelisted,
    discordUserName,
    twitterUserName,
    submitURL,
    claimURL,
    twitterId,
    discordRefreshToken,
    submitted,
    verified,
    image,
    pathTwo,
    whitelisted_two,
    spinner,
    clicked,
    error,
  } = state;

  // ! Parameters
  const getDiscordCode = new URLSearchParams(useLocation().search).get("code");
  // ! Discord obtained from Local Storage
  const getLSDiscordCode = localStorage.getItem("discord_code");
  // ! Twitter Params
  const getTwitterToken = new URLSearchParams(useLocation().search).get(
    "oauth_token"
  );
  const getTwitterVerifier = new URLSearchParams(useLocation().search).get(
    "oauth_verifier"
  );

  // ! Connects your wallet and gets properly formatted address
  const connectWallet = async () => {
    if (!window.ethereum) return alert("Please install Metamask");
    if (!clicked) {
      try {
        dispatch({ type: types.CLICKED });
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        const signer = provider.getSigner();
        const walletAddress = await signer.getAddress();
        dispatch({
          type: types.SET_ACCOUNT,
          payload: { account: walletAddress },
        });
        if (pathTwo) {
          whitelistedTwo(walletAddress);
        }
      } catch (err) {
        dispatch({ type: types.ERROR, payload: err });
      }
    }
  };

  // ! Get discord credentials and save a version locally
  useEffect(() => {
    if (Boolean(getDiscordCode || String(getLSDiscordCode).length > 4)) {
      dispatch({
        type: types.DISCORD_CONNECTED,
        payload: { discordCode: getDiscordCode || getLSDiscordCode },
      });
      // ! Saves discord to local storage for the session because we're using multiple
      // ! SSOs
      if (getDiscordCode) {
        localStorage.setItem("discord_code", getDiscordCode);
      }
      axios.get(twitterStepOne).then((res) =>
        dispatch({
          type: types.SET_TWITTER_CONNECT_URL,
          payload: res.data.auth_url,
        })
      );
    }
  }, [getDiscordCode]);

  // ! When twitter is connected, moves state forward
  useEffect(() => {
    if (getTwitterToken && getTwitterVerifier) {
      dispatch({
        type: types.TWITTER_CONNECTED,
        payload: {
          twitterLoginToken: getTwitterToken,
          twitterLoginVerifier: getTwitterVerifier,
        },
      });
    }
  }, [twitterLoginToken, twitterLoginVerifier]);

  // ! clears local storage
  const cleanLS = async () => {
    localStorage.removeItem("discord_code");
    localStorage.removeItem("whitelisted");
  };

  // ! spin -> verify using codes -> remove discord ls, set whitelisted (holds the door) ->
  // ! state moves forward, saves new states -> spinners done
  const verify = async () => {
    dispatch({ type: types.SPIN });
    await axios
      .post(twitterStepThree, {
        discordCode: discordCode,
        twitterToken: getTwitterToken,
        twitterVerifier: getTwitterVerifier,
      })
      .then((res) => {
        localStorage.removeItem("discord_code");
        localStorage.setItem("whitelisted", res.data.success);
        dispatch({
          type: types.WHITELISTED,
          payload: {
            whitelisted: res.data.success,
            discordUserName: res.data.discord.username,
            twitterUserName: res.data.twitter.username,
            twitterId: res.data.twitter.id,
            discordRefreshToken: res.data.discord.refresh_token,
            verified: true,
          },
        });
      });
    dispatch({ type: types.DONE_SPINNING });
  };

  // ! spins -> submits -> moves state forward -> spins done
  const submit = async () => {
    dispatch({ type: types.SPIN });
    await axios
      .post(submitURL, {
        discordRefresh: discordRefreshToken,
        twitterId: twitterId,
        walletAddress: account,
      })
      .then((res) => {
        dispatch({
          type: types.SUBMITTED,
          payload: {
            submitted: res.data.success,
          },
        });
      });
    dispatch({ type: types.DONE_SPINNING });
  };

  // ! second route whitelist check
  const whitelistedTwo = async (walletAddress) => {
    dispatch({ type: types.SPIN });
    await axios
      .get(`https://793461f8173e.au.ngrok.io/allowlisted/${walletAddress}`)
      .then((res) => {
        console.log(res);
        dispatch({
          type: types.WHITELISTED_TWO,
          payload: {
            whitelisted_two: res.data.success,
            twitterUserName: res.data.username,
          },
        });
      });
    dispatch({ type: types.DONE_SPINNING });
  };

  return (
    <div className="flex flex-col">
      {/* If you want to see the tokens */}
      {/* <p>
        {discordCode} --- {twitterLoginToken} --- {twitterLoginVerifier}
      </p> */}
      {!pathTwo && (
        <a href={discordUrl}>
          {discordConnected ? "Connected To Discord" : "Connect Discord"}
        </a>
      )}
      {(discordConnected || whitelisted) && (
        <a href={twitterUrl}>
          {twitterConnected ? "Connected To Twitter" : "Connect Twitter"}
        </a>
      )}
      {spinner && <h1>Spinner goes here</h1>}
      {whitelisted === false && <p>You are not on the whitelist</p>}
      <button onClick={() => cleanLS()}>Delete LS</button>
      {discordConnected && twitterConnected && !verified && (
        <button onClick={() => verify()}>Verify</button>
      )}
      {twitterConnected && whitelisted === true && (
        <button onClick={() => connectWallet()} disabled={metamaskConnected}>
          {!metamaskConnected ? "Connect MetaMask" : "MetaMask Connected"}
        </button>
      )}
      {!discordConnected && (
        <button onClick={() => dispatch({ type: types.PATH_TWO })}>
          Already submitted your wallet?
        </button>
      )}
      {pathTwo && (
        <button onClick={() => connectWallet()} disabled={metamaskConnected}>
          {!metamaskConnected ? "Connect MetaMask" : "MetaMask Connected"}
        </button>
      )}
      {metamaskConnected && !pathTwo && !submitted && (
        <button onClick={() => submit()}>Submit</button>
      )}
      {(submitted || whitelisted_two) && (
        <a href={`${claimURL}${twitterUserName}`}>Claim Image A</a>
      )}
    </div>
  );
};

export default SSOButtons;
