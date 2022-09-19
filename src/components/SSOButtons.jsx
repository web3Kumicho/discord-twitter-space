import React, { useReducer, useEffect } from "react";
import axios from "axios";
import { useLocation } from "react-router-dom";
import types from "../data/types.json";

const initialState = {
  account: "",
  discordUrl:
    "https://discord.com/api/oauth2/authorize?client_id=1019794603605504070&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fapi%2Fauth%2Fdiscord%2Fredirect&response_type=code&scope=identify",
  discordConnected: false,
  discordCode: "",
  twitterStepOne:
    "https://ixgpg9xk7l.execute-api.us-east-2.amazonaws.com/development/oauth2/twitter/token",
  twitterStepThree:
    "https://ixgpg9xk7l.execute-api.us-east-2.amazonaws.com/development/oauth2/twitter/lookup",
  twitterUrl: "",
  twitterConnected: false,
  twitterLoginToken: "",
  twitterLoginVerifier: "",
  metamaskConnected: false,
  whitelisted: null,
  clicked: false,
  error: "",
};

// Initial state shows connect to discord
// discordConnected state shows twitter login button
// twitterConnected state shows connect w/ metamask button
// check if they're whitelisted
// render MM button if they are whitelisted

function reducer(state, action) {
  switch (action.type) {
    case types.RESET_STATE:
      return initialState;
    case types.SET_ACCOUNT:
      return {
        ...state,
        account: action.payload.account,
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
    case types.CLICKED:
      return { ...state, clicked: true };
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
    twitterConnected,
    twitterLoginToken,
    twitterLoginVerifier,
    metamaskConnected,
    whitelisted,
    clicked,
    error,
  } = state;
  const getDiscordCode = new URLSearchParams(useLocation().search).get("code");
  const getLSDiscordCode = localStorage.getItem("discord_code");
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
      } catch (err) {
        dispatch({ type: types.ERROR, payload: err });
      }
    }
  };

  // ! Sets up the mint cycle state after connection and reconnects if possible
  useEffect(() => {
    if (window.ethereum) {
      const checkWalletConnected = async () => {
        if (!window.ethereum) return alert("Please install Metamask");
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const accounts = await provider.send("eth_accounts", []);
        if (accounts.length !== 0) {
          const signer = provider.getSigner();
          const walletAddress = await signer.getAddress();
          try {
            dispatch({
              type: types.SET_ACCOUNT,
              payload: { account: walletAddress },
            });
          } catch {
            dispatch({
              type: types.ERROR,
              payload: "No authorized account found",
            });
          }
        }
      };
      checkWalletConnected();
    }
  }, [account]);

  // ! If the user switches accounts or saleState is changed -
  // ! it a re-render is fired
  useEffect(() => {
    if (window.ethereum) {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const reset = () => dispatch({ type: types.RESET_STATE });
      window.ethereum.on("accountsChanged", reset);
      const listenForSalesEvent = async () => {
        const accounts = await provider.send("eth_accounts", []);
        const signer = provider.getSigner();
        const walletAddress = await signer.getAddress();
        if (accounts !== 0) {
          dispatch({
            type: types.SET_ACCOUNT,
            payload: { account: walletAddress },
          });
        }
      };
      listenForSalesEvent();
      return () => {
        window.ethereum.removeListener("accountsChanged", reset);
      };
    }
  }, []);

  // ! Resets state if the user cancels a transaction
  useEffect(() => {
    if (
      [
        "User rejected the request.",
        "MetaMask Tx Signature: User denied transaction signature.",
        "User rejected the transaction",
        "User denied account authorization.",
      ].includes(error.message)
    ) {
      dispatch({ type: types.RESET_STATE });
    }
  }, []);

  // ! Get discord credentials and save a version locally
  useEffect(() => {
    if (Boolean(getDiscordCode || String(getLSDiscordCode).length > 4)) {
      dispatch({
        type: types.DISCORD_CONNECTED,
        payload: { discordCode: getDiscordCode || getLSDiscordCode },
      });
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

  const cleanLS = (whitelisted) => {
    localStorage.removeItem("discord_code");
    localStorage.setItem("whitelisted", whitelisted);
  };

  useEffect(() => {
    if (getTwitterToken && getTwitterVerifier) {
      dispatch({
        type: types.TWITTER_CONNECTED,
        payload: {
          twitterLoginToken: getTwitterToken,
          twitterLoginVerifier: getTwitterVerifier,
        },
      });
      // Check if the user is whitelisted
      // delete discord_code from localStorage & update with whitelisted t/f
      // post ()
      // cleanLS(true);
    }
  }, [twitterLoginToken, twitterLoginVerifier]);

  console.log(state);
  return (
    <div className="flex flex-col">
      <p>
        {discordCode} --- {twitterLoginToken} --- {twitterLoginVerifier}
      </p>
      <a href={discordUrl}>Connect Discord</a>
      {(discordConnected || whitelisted) && (
        <a href={twitterUrl}>Connect Twitter</a>
      )}
      {twitterConnected && whitelisted === true && (
        <button onClick={() => connectWallet()}>Connect MetaMask</button>
      )}
      {whitelisted === false && <p>You are not on the whitelist</p>}
      <button onClick={() => cleanLS()}>Delete LS</button>
    </div>
  );
};

export default SSOButtons;
